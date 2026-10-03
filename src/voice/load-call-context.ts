/**
 * @module voice/load-call-context
 *
 * Resolves the {@link CallContext} for a LiveKit voice job from its room metadata. Precedence:
 * 1. `{ "callContext": CallContext }`: set by the outbound-call module on the room; used as is.
 * 2. `{ "tenancyId": string }`: tenancy, unit, property, policy, and perks loaded from Supabase
 *    with the service-role client. Stripe is not read here, so the invoice fields come from the
 *    optional `stripeInvoiceId` / `openBalance` / `invoiceDueDate` metadata keys, else the demo.
 * 3. {@link getDemoCallContext} for anything else, including Supabase errors.
 * Never throws: a bad lookup must not keep the agent from greeting the tenant.
 *
 * Inbound callbacks use {@link loadCallbackSetup} instead: the caller's number maps to a
 * tenancy, the open invoice comes from Stripe, and the tenancy's latest `calls` rows supply the
 * prior conversation and any handoff that still holds. Anything short of a confident match is
 * an unknown caller, who must hear no account details.
 *
 * Depends on: stripe, zod, ./context, ./demo-context, ./inbound-caller, ./supabase-client,
 * @/payments/collection-context, @/payments/stripe
 * Used by: @/voice/worker.ts
 */

import { z } from "zod";

import { loadTenancyRecord } from "@/payments/collection-context";
import { centsToDollars, getStripeClient } from "@/payments/stripe";

import type { CallContext } from "./context";
import { getDemoCallContext } from "./demo-context";
import { normalizePhoneE164 } from "./inbound-caller";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "./supabase-client";

export type TCallContextSource = "room_metadata" | "supabase" | "demo";

export type TCallSetup = {
    callContext: CallContext;
    /** Tenancy row id when known (metadata or Supabase lookup); persistence key for the call. */
    tenancyId: string | null;
    source: TCallContextSource;
};

export type TLoadCallContextDeps = {
    /** Supabase client; `undefined` uses the env service-role client, `null` disables lookups. */
    client?: TVoiceSupabaseClient | null;
    log?: Pick<Console, "warn">;
};

const callContextSchema = z.object({
    tenantName: z.string(),
    propertyName: z.string(),
    unitLabel: z.string(),
    phone: z.string(),
    email: z.string(),
    openBalance: z.number(),
    invoiceDueDate: z.string(),
    policy: z.object({
        maxInstallments: z.number(),
        graceDays: z.number(),
        feeWaiverCap: z.number(),
    }),
    perks: z.array(z.object({
        id: z.string(),
        description: z.string(),
        condition: z.string().optional(),
    })),
    stripeInvoiceId: z.string(),
    managerName: z.string().optional(),
    ledger: z.array(z.object({
        month: z.string(),
        amount: z.number(),
        status: z.enum(["unpaid", "late", "on_time"]),
    })).optional(),
}) satisfies z.ZodType<CallContext>;

const roomMetadataSchema = z.object({
    callContext: z.unknown().optional(),
    tenancyId: z.string().min(1).optional(),
    stripeInvoiceId: z.string().min(1).optional(),
    openBalance: z.number().optional(),
    invoiceDueDate: z.string().min(1).optional(),
});

type TRoomMetadata = z.infer<typeof roomMetadataSchema>;

/**
 * Parses LiveKit room metadata JSON, or returns `null` when absent or not a JSON object.
 *
 * @param roomMetadata - Raw `room.metadata` string
 */
function parseRoomMetadata(roomMetadata: string | undefined): TRoomMetadata | null {
    if (!roomMetadata?.trim()) {
        return null;
    }
    try {
        const parsed = roomMetadataSchema.safeParse(JSON.parse(roomMetadata));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * Builds a call context from the tenancy's Supabase rows, filling gaps from the demo context.
 * Returns `null` when the tenancy row does not exist.
 *
 * @param client - Service-role Supabase client
 * @param metadata - Parsed room metadata carrying `tenancyId` and optional invoice fields
 */
async function loadFromTenancy(
    client: TVoiceSupabaseClient,
    metadata: TRoomMetadata & { tenancyId: string },
): Promise<CallContext | null> {
    const record = await loadTenancyRecord(client, { stripeCustomerId: null, tenancyId: metadata.tenancyId });
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
        openBalance: metadata.openBalance ?? demo.openBalance,
        invoiceDueDate: metadata.invoiceDueDate ?? demo.invoiceDueDate,
        policy: record.policy ?? demo.policy,
        perks: record.perks ?? demo.perks,
        stripeInvoiceId: metadata.stripeInvoiceId ?? demo.stripeInvoiceId,
    };
}

/**
 * Resolves the call context plus where it came from and the tenancy id for persistence.
 *
 * @param roomMetadata - Raw LiveKit `room.metadata` string
 * @param deps - Optional Supabase client and logger overrides (tests)
 */
export async function loadCallSetup(
    roomMetadata: string | undefined,
    deps: TLoadCallContextDeps = {},
): Promise<TCallSetup> {
    const log = deps.log ?? console;
    const metadata = parseRoomMetadata(roomMetadata);
    const tenancyId = metadata?.tenancyId ?? null;

    if (metadata?.callContext !== undefined) {
        const parsed = callContextSchema.safeParse(metadata.callContext);
        if (parsed.success) {
            return { callContext: parsed.data, tenancyId, source: "room_metadata" };
        }
        log.warn("[voice/load-call-context] room metadata callContext is malformed; ignoring it");
    }

    if (metadata?.tenancyId) {
        const client = deps.client === undefined ? getVoiceSupabaseClient() : deps.client;
        if (!client) {
            log.warn("[voice/load-call-context] Supabase is not configured; using the demo context");
        } else {
            try {
                const callContext = await loadFromTenancy(client, { ...metadata, tenancyId: metadata.tenancyId });
                if (callContext) {
                    return { callContext, tenancyId: metadata.tenancyId, source: "supabase" };
                }
                log.warn(`[voice/load-call-context] tenancy ${metadata.tenancyId} not found; using the demo context`);
            } catch (error) {
                log.warn(`[voice/load-call-context] Supabase lookup failed; using the demo context: ${String(error)}`);
            }
        }
    }

    return { callContext: getDemoCallContext(), tenancyId, source: "demo" };
}

/** Open-invoice fields for a callback, read from Stripe. */
export type TInvoiceSnapshot = {
    invoiceId: string;
    openBalance: number;
    dueDate: string;
};

export type TFetchInvoice = (lookup: {
    invoiceId: string | null;
    customerId: string | null;
}) => Promise<TInvoiceSnapshot | null>;

/** A callback from a number that matches a tenancy. */
export type TKnownCallback = {
    kind: "known";
    phoneNumber: string;
    tenancyId: string;
    callContext: CallContext;
    /** An earlier handoff on any channel holds for this call too. */
    handoff: { active: boolean; reason: string | null };
    /** Compact summary of the latest conversation with a transcript, for the brain's history. */
    priorConversation: string | null;
};

/** A callback that maps to no tenancy (or a lookup that failed): no account details. */
export type TUnknownCallback = {
    kind: "unknown";
    phoneNumber: string | null;
};

export type TCallbackSetup = TKnownCallback | TUnknownCallback;

export type TLoadCallbackSetupDeps = TLoadCallContextDeps & {
    /** Stripe invoice lookup; defaults to the `STRIPE_SECRET_KEY` client. */
    fetchInvoice?: TFetchInvoice;
};

const PRIOR_CALLS_LIMIT = 5;
const PRIOR_TRANSCRIPT_LINES = 10;
const STRIPE_LOOKUP_TIMEOUT_MS = 3000;

const CHANNEL_LABELS: Record<string, string> = {
    outbound_call: "a phone call we placed",
    callback: "a call they made to us",
    text: "text messages",
};

const priorCallSchema = z.object({
    channel: z.string(),
    status: z.string(),
    handoff_reason: z.string().nullable(),
    transcript: z.string().nullable(),
    stripe_invoice_id: z.string(),
    created_at: z.string(),
});

type TPriorCall = z.infer<typeof priorCallSchema>;

/**
 * Converts a Stripe invoice to the snapshot the call context needs.
 *
 * @param invoice - Invoice id, remaining amount (cents), and due/created timestamps
 */
function toInvoiceSnapshot(invoice: {
    id: string;
    amount_remaining: number;
    due_date: number | null;
    created: number;
}): TInvoiceSnapshot {
    return {
        invoiceId: invoice.id,
        openBalance: centsToDollars(invoice.amount_remaining),
        dueDate: new Date((invoice.due_date ?? invoice.created) * 1000).toISOString().slice(0, 10),
    };
}

/**
 * Default {@link TFetchInvoice}: the last call's invoice while it is still open, else the
 * customer's newest open invoice, else the last call's invoice as is (e.g. already paid).
 *
 * @param lookup - Invoice id from the latest call and the tenancy's Stripe customer id
 */
const fetchStripeInvoice: TFetchInvoice = async ({ invoiceId, customerId }) => {
    const stripe = getStripeClient();
    if (!stripe) {
        return null;
    }
    const prior = invoiceId ? await stripe.invoices.retrieve(invoiceId).catch(() => null) : null;
    const priorSnapshot = prior && invoiceId ? toInvoiceSnapshot({ ...prior, id: invoiceId }) : null;
    if (priorSnapshot && prior?.status === "open" && priorSnapshot.openBalance > 0) {
        return priorSnapshot;
    }
    if (customerId) {
        const open = await stripe.invoices.list({ customer: customerId, status: "open", limit: 1 }).catch(() => null);
        const latest = open?.data[0];
        if (latest?.id) {
            return toInvoiceSnapshot({ ...latest, id: latest.id });
        }
    }
    return priorSnapshot;
};

/**
 * Rejects after `ms` so a slow Stripe call cannot hold up the callback greeting.
 *
 * @param promise - Lookup to race
 * @param ms - Timeout in milliseconds
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * Number formats a tenancy row might store for the same E.164 caller.
 *
 * @param e164 - Normalised caller number
 */
function phoneCandidates(e164: string): string[] {
    const digits = e164.slice(1);
    const candidates = [e164, digits];
    if (digits.length === 11 && digits.startsWith("1")) {
        candidates.push(digits.slice(1));
    }
    return candidates;
}

/**
 * Compact text of the latest conversation that has a transcript: channel, date, outcome, and
 * its last {@link PRIOR_TRANSCRIPT_LINES} lines. `null` when there is none.
 *
 * @param calls - Prior calls, newest first
 * @param today - Today's date (YYYY-MM-DD, UTC)
 */
function summarisePriorConversation(calls: TPriorCall[], today: string): string | null {
    const last = calls.find((call) => call.transcript?.trim());
    if (!last?.transcript) {
        return null;
    }
    const lines = last.transcript.split("\n").map((line) => line.trim()).filter(Boolean);
    const outcome = last.status === "waiting_on_person" || last.handoff_reason
        ? `ended waiting on a person${last.handoff_reason ? ` (flagged: ${last.handoff_reason})` : ""}`
        : last.status === "paid" ? "ended with the balance paid" : "ended without a payment";
    const day = last.created_at.slice(0, 10);
    return [
        `Previous conversation: ${CHANNEL_LABELS[last.channel] ?? last.channel} ${day === today ? "earlier today" : `on ${day}`}, `
            + `${outcome}. Last lines:`,
        ...lines.slice(-PRIOR_TRANSCRIPT_LINES),
    ].join("\n");
}

/**
 * Looks up the tenancy behind a callback number and builds its call setup. Unknown, hidden, or
 * unresolvable numbers return `{ kind: "unknown" }`. Never throws.
 *
 * @param phoneNumber - Caller's number (`sip.phoneNumber`), or `null` when withheld
 * @param deps - Optional Supabase client, Stripe lookup, and logger overrides (tests)
 */
export async function loadCallbackSetup(
    phoneNumber: string | null,
    deps: TLoadCallbackSetupDeps = {},
): Promise<TCallbackSetup> {
    const log = deps.log ?? console;
    const e164 = phoneNumber ? normalizePhoneE164(phoneNumber) : null;
    const unknown: TUnknownCallback = { kind: "unknown", phoneNumber: e164 };
    if (!e164) {
        return unknown;
    }
    const client = deps.client === undefined ? getVoiceSupabaseClient() : deps.client;
    if (!client) {
        log.warn("[voice/load-call-context] Supabase is not configured; treating the caller as unknown");
        return unknown;
    }

    try {
        const match = await client
            .from("tenancies")
            .select("id, stripe_customer_id")
            .in("phone", phoneCandidates(e164))
            .limit(1)
            .maybeSingle();
        if (match.error) {
            throw new Error(match.error.message);
        }
        if (!match.data) {
            return unknown;
        }
        const tenancyId = match.data.id;

        const [record, callsResult] = await Promise.all([
            loadTenancyRecord(client, { stripeCustomerId: null, tenancyId }),
            client
                .from("calls")
                .select("channel, status, handoff_reason, transcript, stripe_invoice_id, created_at")
                .eq("tenancy_id", tenancyId)
                .order("created_at", { ascending: false })
                .limit(PRIOR_CALLS_LIMIT),
        ]);
        if (!record) {
            return unknown;
        }
        if (callsResult.error) {
            throw new Error(callsResult.error.message);
        }
        const priorCalls = z.array(priorCallSchema).parse(callsResult.data ?? []);
        const latest = priorCalls[0];

        const fetchInvoice = deps.fetchInvoice ?? fetchStripeInvoice;
        const invoice = await withTimeout(
            fetchInvoice({ invoiceId: latest?.stripe_invoice_id ?? null, customerId: match.data.stripe_customer_id }),
            STRIPE_LOOKUP_TIMEOUT_MS,
        ).catch((error: unknown) => {
            log.warn(`[voice/load-call-context] Stripe invoice lookup failed; using fallbacks: ${String(error)}`);
            return null;
        });

        const demo = getDemoCallContext();
        const callContext: CallContext = {
            tenantName: record.tenantName,
            propertyName: record.propertyName ?? demo.propertyName,
            unitLabel: record.unitLabel ?? demo.unitLabel,
            phone: e164,
            email: record.email ?? demo.email,
            openBalance: invoice?.openBalance ?? demo.openBalance,
            invoiceDueDate: invoice?.dueDate ?? demo.invoiceDueDate,
            policy: record.policy ?? demo.policy,
            perks: record.perks ?? demo.perks,
            stripeInvoiceId: invoice?.invoiceId ?? latest?.stripe_invoice_id ?? demo.stripeInvoiceId,
        };
        const handoffActive = Boolean(latest && (latest.handoff_reason || latest.status === "waiting_on_person"));

        return {
            kind: "known",
            phoneNumber: e164,
            tenancyId,
            callContext,
            handoff: { active: handoffActive, reason: handoffActive ? latest?.handoff_reason ?? null : null },
            priorConversation: summarisePriorConversation(priorCalls, new Date().toISOString().slice(0, 10)),
        };
    } catch (error) {
        log.warn(`[voice/load-call-context] callback lookup failed; treating the caller as unknown: ${String(error)}`);
        return unknown;
    }
}

/**
 * Resolves the call context for a voice job: room `callContext`, then Supabase by `tenancyId`,
 * then the demo context.
 *
 * @param roomMetadata - Raw LiveKit `room.metadata` string
 * @param deps - Optional Supabase client and logger overrides (tests)
 */
export async function loadCallContext(
    roomMetadata: string | undefined,
    deps: TLoadCallContextDeps = {},
): Promise<CallContext> {
    return (await loadCallSetup(roomMetadata, deps)).callContext;
}
