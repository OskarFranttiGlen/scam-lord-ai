/**
 * @module voice/persist-call
 *
 * Writes a finished LiveKit voice call to Supabase: one `calls` row per room (upsert on
 * `livekit_room_name`) with transcript, Jev checks, handoff reason, and the payment-link flag,
 * plus a `plans` row when the tenant accepted a plan. Runs from the worker's shutdown callback,
 * so every failure is logged and swallowed: persistence must never crash the worker.
 *
 * Depends on: ./context, ./supabase-client, @/hooks/supabase (generated types)
 * Used by: @/voice/worker.ts
 */

import type { Json, TablesInsert } from "@/hooks/supabase";

import type { CallContext, CallState, TAcceptedPlan } from "./context";
import { handoffReasonFor, saveMaintenanceReports, saveOfficeTasks } from "./maintenance";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "./supabase-client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type THandoffReason = "hardship" | "dispute" | "distressed";

/** `calls.channel` values written by the voice worker (text is written by the SMS webhook). */
export type TVoiceCallChannel = "outbound_call" | "callback";

export type TPersistCallInput = {
    roomName: string;
    callContext: CallContext;
    state: CallState;
    startedAt: Date;
    endedAt: Date;
    /** Known tenancy row id; otherwise resolved from the call context. */
    tenancyId?: string | null;
    /** Defaults to `outbound_call`; inbound callbacks pass `callback`. */
    channel?: TVoiceCallChannel;
    /** Reason of a handoff that started before this call and still holds (callbacks). */
    carriedHandoffReason?: string | null;
    /** Supabase client; `undefined` uses the env service-role client. */
    client?: TVoiceSupabaseClient | null;
    log?: Pick<Console, "info" | "warn" | "error">;
};

export type TPersistCallResult = {
    callId: string;
    planId: string | null;
};

/**
 * Finds the tenancy for a call: explicit id, then phone, then a prior call on the same
 * Stripe invoice, then tenant name. Returns `null` when nothing matches.
 *
 * @param client - Service-role Supabase client
 * @param callContext - Call snapshot used for the lookups
 * @param tenancyId - Explicit tenancy id, when the room metadata carried one
 */
async function resolveTenancyId(
    client: TVoiceSupabaseClient,
    callContext: CallContext,
    tenancyId: string | null | undefined,
): Promise<string | null> {
    if (tenancyId) {
        return tenancyId;
    }

    const byPhone = await client.from("tenancies").select("id").eq("phone", callContext.phone).limit(1).maybeSingle();
    if (byPhone.data) {
        return byPhone.data.id;
    }

    const byInvoice = await client
        .from("calls")
        .select("tenancy_id")
        .eq("stripe_invoice_id", callContext.stripeInvoiceId)
        .limit(1)
        .maybeSingle();
    if (byInvoice.data) {
        return byInvoice.data.tenancy_id;
    }

    const byName = await client.from("tenancies").select("id").eq("name", callContext.tenantName).limit(1).maybeSingle();
    return byName.data?.id ?? null;
}

/**
 * First reason of the latest Jev check that triggered a handoff, if any.
 *
 * @param state - Final call state
 */
function handoffReason(state: CallState): THandoffReason | null {
    for (let i = state.jevChecks.length - 1; i >= 0; i--) {
        const { outcome } = state.jevChecks[i];
        if (outcome.decision === "handoff") {
            return outcome.reasons[0] ?? null;
        }
    }
    return null;
}

/**
 * Inserts or replaces the single plan row for a call.
 *
 * @param client - Service-role Supabase client
 * @param callId - Parent `calls.id`
 * @param plan - Accepted plan from call state
 */
async function upsertPlan(client: TVoiceSupabaseClient, callId: string, plan: TAcceptedPlan): Promise<string> {
    const row: TablesInsert<"plans"> = {
        call_id: callId,
        installment_count: plan.installments.length,
        installment_dates: plan.installments.map((installment) => installment.date),
        installment_amounts: plan.installments.map((installment) => installment.amount),
        fee_waiver_amount: plan.feeWaiver ?? 0,
        perk_id: plan.perkId && UUID_PATTERN.test(plan.perkId) ? plan.perkId : null,
    };

    const existing = await client.from("plans").select("id").eq("call_id", callId).limit(1).maybeSingle();
    if (existing.error) {
        throw new Error(`plans lookup failed: ${existing.error.message}`);
    }

    const write = existing.data
        ? client.from("plans").update(row).eq("id", existing.data.id).select("id").single()
        : client.from("plans").insert(row).select("id").single();
    const { data, error } = await write;
    if (error) {
        throw new Error(`plans write failed: ${error.message}`);
    }
    return data.id;
}

/**
 * Persists the call (and accepted plan) to Supabase. Returns ids on success, `null` on any
 * failure or missing configuration; never throws.
 *
 * @param input - Room, call context, final state, timestamps, and optional overrides
 */
export async function persistCall(input: TPersistCallInput): Promise<TPersistCallResult | null> {
    const { roomName, callContext, state, startedAt, endedAt } = input;
    const log = input.log ?? console;

    try {
        const client = input.client === undefined ? getVoiceSupabaseClient() : input.client;
        if (!client) {
            log.warn("[voice/persist-call] Supabase is not configured; call not persisted");
            return null;
        }

        const tenancyId = await resolveTenancyId(client, callContext, input.tenancyId);
        if (!tenancyId) {
            log.warn(`[voice/persist-call] no tenancy matches ${callContext.tenantName}; call ${roomName} not persisted`);
            return null;
        }

        const row: TablesInsert<"calls"> = {
            livekit_room_name: roomName,
            tenancy_id: tenancyId,
            channel: input.channel ?? "outbound_call",
            stripe_invoice_id: callContext.stripeInvoiceId,
            status: state.handoffActive ? "waiting_on_person" : "in_progress",
            transcript: state.transcriptLines.join("\n"),
            jev_checks: state.jevChecks satisfies Json,
            handoff_reason: handoffReasonFor(state, handoffReason(state)) ?? input.carriedHandoffReason ?? null,
            tenant_feedback: state.tenantFeedback ?? null,
            satisfaction_score: state.satisfactionScore ?? null,
            payment_link_sent: state.paymentLinkSent,
            started_at: startedAt.toISOString(),
            ended_at: endedAt.toISOString(),
            updated_at: endedAt.toISOString(),
        };
        const { data, error } = await client
            .from("calls")
            .upsert(row, { onConflict: "livekit_room_name" })
            .select("id")
            .single();
        if (error) {
            throw new Error(`calls upsert failed: ${error.message}`);
        }

        const planId = state.acceptedPlan ? await upsertPlan(client, data.id, state.acceptedPlan) : null;
        await saveMaintenanceReports(client, { tenancyId, callId: data.id, reports: state.maintenanceReports });
        await saveOfficeTasks(client, {
            tenancyId,
            callId: data.id,
            stripeInvoiceId: callContext.stripeInvoiceId,
            tasks: state.officeTasks,
        });
        log.info(
            `[voice/persist-call] saved call ${data.id} for room ${roomName} `
            + `(${state.transcriptLines.length} transcript lines, ${state.jevChecks.length} Jev checks`
            + `${planId ? `, plan ${planId}` : ""})`,
        );
        return { callId: data.id, planId };
    } catch (error) {
        log.error(`[voice/persist-call] failed to persist call ${roomName}: ${String(error)}`);
        return null;
    }
}
