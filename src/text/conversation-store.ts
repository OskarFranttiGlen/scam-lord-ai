/**
 * @module text/conversation-store
 *
 * Supabase side of the SMS thread (docs/SPEC.md, Text): maps a sender's number to a tenancy,
 * builds the agent's `CallContext`, and loads or creates the tenancy's single `calls` row with
 * channel `text`. The row's `conversation` column holds the model messages and agent state so
 * each inbound text resumes the same conversation. A handoff on the tenancy's latest row on any
 * channel carries into the thread.
 *
 * Depends on: ai, zod, @/hooks/supabase, @/payments/collection-context, @/payments/stripe,
 * @/voice/context, @/voice/demo-context, @/voice/supabase-client
 * Used by: @/text/handle-inbound-text.ts
 */

import { modelMessageSchema, type ModelMessage } from "ai";
import { z } from "zod";

import type { TJevCheckRecord } from "@/collection/types";
import type { Json, Tables, TablesInsert, TablesUpdate } from "@/hooks/supabase";
import { loadTenancyRecord } from "@/payments/collection-context";
import { centsToDollars, getStripeClient } from "@/payments/stripe";
import { normalizeCallState, type CallContext, type CallState, type TAcceptedPlan } from "@/voice/context";
import { getDemoCallContext } from "@/voice/demo-context";
import {
    handoffReasonFor,
    hasRecentFeedback,
    loadMaintenanceHistory,
    saveMaintenanceReports,
    saveOfficeTasks,
} from "@/voice/maintenance";
import type { TVoiceSupabaseClient } from "@/voice/supabase-client";

export type THandoffReason = "hardship" | "dispute" | "distressed" | "urgent_maintenance";

export type TStoredCallRow = Pick<
    Tables<"calls">,
    | "id"
    | "channel"
    | "status"
    | "handoff_reason"
    | "stripe_invoice_id"
    | "transcript"
    | "jev_checks"
    | "payment_link_sent"
    | "conversation"
>;

export type TTextConversation = {
    callId: string;
    tenancyId: string;
    context: CallContext;
    messages: ModelMessage[];
    state: CallState;
    status: string;
    /** Reason from another channel's handoff that this thread inherited. */
    carriedHandoffReason: THandoffReason | null;
};

/** Messages kept per thread; older turns drop off so prompts stay small and fast. */
const MAX_STORED_MESSAGES = 40;

// One string literal: supabase-js infers the row type from it.
const CALL_ROW_COLUMNS = "id, channel, status, handoff_reason, stripe_invoice_id, transcript, jev_checks, payment_link_sent, conversation";

const storedConversationSchema = z.object({
    messages: z.array(z.unknown()).optional(),
    state: z.unknown().optional(),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalizes a phone number to E.164 (US numbers without a country code get `+1`), or `null`.
 *
 * @param raw - Number as Twilio or the PMS wrote it
 */
export function toE164(raw: string): string | null {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (trimmed.startsWith("+")) {
        return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    }
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith("1")) {
        return `+${digits}`;
    }
    return null;
}

/**
 * Phone values to match against `tenancies.phone`: the E.164 form, then the raw text.
 *
 * @param raw - Sender number
 */
export function phoneCandidates(raw: string): string[] {
    const e164 = toE164(raw);
    return [...new Set([e164, raw.trim()].filter((value): value is string => Boolean(value)))];
}

/**
 * Tenancy id for a sender's number, or `null` when no tenancy has it.
 *
 * @param db - Service-role Supabase client
 * @param phone - Sender number (`From`)
 */
export async function findTenancyIdByPhone(db: TVoiceSupabaseClient, phone: string): Promise<string | null> {
    const candidates = phoneCandidates(phone);
    if (!candidates.length) {
        return null;
    }
    const { data, error } = await db.from("tenancies").select("id").in("phone", candidates).limit(1).maybeSingle();
    if (error) {
        throw new Error(`tenancies phone lookup failed: ${error.message}`);
    }
    return data?.id ?? null;
}

function isHandoffRow(row: TStoredCallRow): boolean {
    return row.status === "waiting_on_person" || row.handoff_reason != null;
}

function asHandoffReason(value: string | null): THandoffReason | null {
    return value === "hardship" || value === "dispute" || value === "distressed" || value === "urgent_maintenance"
        ? value
        : null;
}

function parseMessages(value: unknown[] | undefined): ModelMessage[] {
    const parsed = z.array(modelMessageSchema).safeParse(value ?? []);
    return parsed.success ? parsed.data : [];
}

/**
 * Resumes the thread from the tenancy's `calls` rows (newest activity first): the text row's
 * stored messages and state, with any handoff from the latest row on another channel.
 *
 * @param rows - The tenancy's calls rows, ordered by `updated_at` descending
 */
export function resumeTextState(rows: TStoredCallRow[]): {
    textRow: TStoredCallRow | null;
    messages: ModelMessage[];
    state: CallState;
    carriedHandoffReason: THandoffReason | null;
} {
    const textRow = rows.find(row => row.channel === "text") ?? null;
    const latest = rows[0] ?? null;
    const stored = storedConversationSchema.safeParse(textRow?.conversation ?? {});
    const state = normalizeCallState(stored.success ? stored.data.state : undefined);
    const messages = parseMessages(stored.success ? stored.data.messages : undefined);

    const carried = latest && latest !== textRow && isHandoffRow(latest);
    if (carried || (textRow && isHandoffRow(textRow))) {
        state.handoffActive = true;
    }
    return {
        textRow,
        messages,
        state,
        carriedHandoffReason: carried ? asHandoffReason(latest.handoff_reason) ?? "hardship" : null,
    };
}

function jevHandoffReason(checks: TJevCheckRecord[]): string | null {
    for (let i = checks.length - 1; i >= 0; i--) {
        if (checks[i].outcome.decision === "handoff") {
            return checks[i].outcome.reasons[0] ?? null;
        }
    }
    return null;
}

/**
 * Keeps the newest messages, starting at a tenant message so tool calls keep their results.
 *
 * @param messages - Full model history after the turn
 */
function trimMessages(messages: ModelMessage[]): ModelMessage[] {
    if (messages.length <= MAX_STORED_MESSAGES) {
        return messages;
    }
    const tail = messages.slice(-MAX_STORED_MESSAGES);
    const start = tail.findIndex(message => message.role === "user");
    return start === -1 ? tail : tail.slice(start);
}

function toJson(value: unknown): Json {
    return JSON.parse(JSON.stringify(value));
}

/**
 * Row update for the text thread after a turn: transcript, Jev trace, handoff, messages.
 *
 * @param input.state - Agent state after the turn
 * @param input.messages - Model messages after the turn
 * @param input.messageSid - Inbound Twilio message SID
 * @param input.previousStatus - Row status before the turn (`paid` stays paid)
 * @param input.carriedHandoffReason - Handoff reason inherited from another channel
 */
export function buildTextRowUpdate(input: {
    state: CallState;
    messages: ModelMessage[];
    messageSid?: string;
    previousStatus: string;
    carriedHandoffReason: THandoffReason | null;
}): TablesUpdate<"calls"> {
    const { state } = input;
    const status = state.handoffActive
        ? "waiting_on_person"
        : input.previousStatus === "paid" ? "paid" : "in_progress";
    return {
        status,
        handoff_reason: state.handoffActive
            ? handoffReasonFor(state, jevHandoffReason(state.jevChecks)) ?? input.carriedHandoffReason
            : null,
        tenant_feedback: state.tenantFeedback ?? null,
        transcript: state.transcriptLines.join("\n"),
        jev_checks: state.jevChecks satisfies Json,
        payment_link_sent: state.paymentLinkSent,
        conversation: toJson({ messages: trimMessages(input.messages), state }),
        ...(input.messageSid ? { twilio_message_sid: input.messageSid } : {}),
        updated_at: new Date().toISOString(),
    };
}

/**
 * Open balance and due date from the tenancy's Stripe invoice when it is still open, else `null`.
 *
 * @param invoiceId - Stripe invoice id from the tenancy's latest call
 */
async function readOpenInvoice(invoiceId: string): Promise<{ openBalance: number; invoiceDueDate: string } | null> {
    const stripe = getStripeClient();
    if (!stripe || !invoiceId.startsWith("in_")) {
        return null;
    }
    try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        if (invoice.status !== "open" || invoice.amount_remaining <= 0) {
            return null;
        }
        return {
            openBalance: centsToDollars(invoice.amount_remaining),
            invoiceDueDate: new Date((invoice.due_date ?? invoice.created) * 1000).toISOString().slice(0, 10),
        };
    } catch {
        return null;
    }
}

/**
 * Agent context for the tenancy: Supabase tenancy, property, policy, perks; the invoice from
 * Stripe when the latest call's invoice is open; the demo context for anything missing.
 *
 * @param db - Service-role Supabase client
 * @param tenancyId - Tenancy row id
 * @param invoiceId - Stripe invoice id of the tenancy's latest call, if any
 */
async function loadTextCallContext(
    db: TVoiceSupabaseClient,
    tenancyId: string,
    invoiceId: string | null,
): Promise<CallContext | null> {
    const [record, invoice, maintenanceRequests] = await Promise.all([
        loadTenancyRecord(db, { stripeCustomerId: null, tenancyId }),
        invoiceId ? readOpenInvoice(invoiceId) : Promise.resolve(null),
        loadMaintenanceHistory(db, tenancyId),
    ]);
    if (!record) {
        return null;
    }
    const demo = getDemoCallContext();
    return {
        tenantName: record.tenantName,
        propertyName: record.propertyName ?? demo.propertyName,
        unitLabel: record.unitLabel ?? demo.unitLabel,
        phone: record.phone,
        email: record.email ?? demo.email,
        openBalance: invoice?.openBalance ?? demo.openBalance,
        invoiceDueDate: invoice?.invoiceDueDate ?? demo.invoiceDueDate,
        policy: record.policy ?? demo.policy,
        perks: record.perks ?? demo.perks,
        stripeInvoiceId: invoiceId ?? demo.stripeInvoiceId,
        maintenanceRequests,
    };
}

/**
 * Inserts the tenancy's text row, or returns the one a concurrent message just created.
 *
 * @param db - Service-role Supabase client
 * @param row - New text row
 */
async function createTextRow(db: TVoiceSupabaseClient, row: TablesInsert<"calls">): Promise<TStoredCallRow> {
    const inserted = await db.from("calls").insert(row).select(CALL_ROW_COLUMNS).single();
    if (!inserted.error) {
        return inserted.data;
    }
    if (inserted.error.code !== "23505") {
        throw new Error(`text conversation insert failed: ${inserted.error.message}`);
    }
    const existing = await db
        .from("calls")
        .select(CALL_ROW_COLUMNS)
        .eq("tenancy_id", row.tenancy_id)
        .eq("channel", "text")
        .single();
    if (existing.error) {
        throw new Error(`text conversation lookup failed: ${existing.error.message}`);
    }
    return existing.data;
}

/**
 * Loads (or starts) the tenancy's text conversation with its agent context and handoff state.
 * Returns `null` when the tenancy row does not exist.
 *
 * @param db - Service-role Supabase client
 * @param tenancyId - Tenancy row id
 */
export async function loadTextConversation(
    db: TVoiceSupabaseClient,
    tenancyId: string,
): Promise<TTextConversation | null> {
    const rowsResult = await db
        .from("calls")
        .select(CALL_ROW_COLUMNS)
        .eq("tenancy_id", tenancyId)
        .order("updated_at", { ascending: false })
        .limit(20);
    if (rowsResult.error) {
        throw new Error(`calls lookup failed: ${rowsResult.error.message}`);
    }
    const rows = rowsResult.data;
    const resumed = resumeTextState(rows);
    const invoiceId = resumed.textRow?.stripe_invoice_id
        ?? rows.find(row => row.channel !== "text")?.stripe_invoice_id
        ?? null;

    const [context, recentFeedback] = await Promise.all([
        loadTextCallContext(db, tenancyId, invoiceId),
        hasRecentFeedback(db, tenancyId),
    ]);
    if (!context) {
        return null;
    }
    resumed.state.feedbackRecorded = recentFeedback;

    const textRow = resumed.textRow ?? await createTextRow(db, {
        tenancy_id: tenancyId,
        channel: "text",
        stripe_invoice_id: context.stripeInvoiceId,
        status: resumed.state.handoffActive ? "waiting_on_person" : "in_progress",
        handoff_reason: resumed.carriedHandoffReason,
        started_at: new Date().toISOString(),
    });

    return {
        callId: textRow.id,
        tenancyId,
        context,
        messages: resumed.messages,
        state: resumed.state,
        status: textRow.status,
        carriedHandoffReason: resumed.carriedHandoffReason,
    };
}

/**
 * Inserts or replaces the plan row for the text thread.
 *
 * @param db - Service-role Supabase client
 * @param callId - Text thread `calls.id`
 * @param plan - Accepted plan from agent state
 */
async function upsertPlan(db: TVoiceSupabaseClient, callId: string, plan: TAcceptedPlan): Promise<void> {
    const row: TablesInsert<"plans"> = {
        call_id: callId,
        installment_count: plan.installments.length,
        installment_dates: plan.installments.map(installment => installment.date),
        installment_amounts: plan.installments.map(installment => installment.amount),
        fee_waiver_amount: plan.feeWaiver ?? 0,
        perk_id: plan.perkId && UUID_PATTERN.test(plan.perkId) ? plan.perkId : null,
    };
    const existing = await db.from("plans").select("id").eq("call_id", callId).limit(1).maybeSingle();
    if (existing.error) {
        throw new Error(`plans lookup failed: ${existing.error.message}`);
    }
    const { error } = existing.data
        ? await db.from("plans").update(row).eq("id", existing.data.id)
        : await db.from("plans").insert(row);
    if (error) {
        throw new Error(`plans write failed: ${error.message}`);
    }
}

/**
 * Saves the thread after a turn (and the plan, when the tenant accepted one this turn).
 *
 * @param db - Service-role Supabase client
 * @param conversation - Thread loaded for this turn
 * @param update.messages - Model messages after the turn
 * @param update.state - Agent state after the turn
 * @param update.messageSid - Inbound Twilio message SID
 */
export async function saveTextConversation(
    db: TVoiceSupabaseClient,
    conversation: TTextConversation,
    update: { messages: ModelMessage[]; state: CallState; messageSid?: string },
): Promise<void> {
    const { error } = await db
        .from("calls")
        .update(buildTextRowUpdate({
            ...update,
            previousStatus: conversation.status,
            carriedHandoffReason: conversation.carriedHandoffReason,
        }))
        .eq("id", conversation.callId);
    if (error) {
        throw new Error(`text conversation save failed: ${error.message}`);
    }
    if (update.state.acceptedPlan) {
        await upsertPlan(db, conversation.callId, update.state.acceptedPlan);
    }
    await saveMaintenanceReports(db, {
        tenancyId: conversation.tenancyId,
        callId: conversation.callId,
        reports: update.state.maintenanceReports,
    });
    await saveOfficeTasks(db, {
        tenancyId: conversation.tenancyId,
        callId: conversation.callId,
        stripeInvoiceId: conversation.context.stripeInvoiceId,
        tasks: update.state.officeTasks,
    });
}
