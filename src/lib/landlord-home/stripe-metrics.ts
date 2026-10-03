/**
 * @module landlord-home/stripe-metrics
 * Home tiles from Stripe Sync invoices and the calls that worked them.
 * Depends on: calls.stripe_invoice_id, stripe.invoices (coworker schema).
 * Used by: use-home-metrics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ISyncedInvoice {
    id: string;
    amountPaidCents: number;
    amountRemainingCents: number;
    status: string | null;
    /** Unix seconds. Null means the balance is due now. */
    dueDateUnix: number | null;
}

export interface ICallTiming {
    invoiceId?: string | null;
    status?: string | null;
    startedAt: string | null;
    endedAt: string | null;
    createdAt?: string | null;
}

export interface IHomeMetrics {
    recovered: number | null;
    stillOverdue: number | null;
    promised: number | null;
    /** Paid cents / charge cents. Null when nothing was charged or sync is missing. */
    collectionRate: number | null;
    /** Minutes from the first touch to the call marked paid. */
    medianResolutionMinutes: number | null;
    /** Mean call rows on invoices that were collected. */
    averageTouches: number | null;
}

const SKIPPED = new Set(["void", "draft"]);

function timestamp(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = values.toSorted((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rent collected divided by charges. A charge is paid plus still on the invoice. */
function collectionRate(invoices: readonly ISyncedInvoice[]): number | null {
    let paidCents = 0;
    let chargeCents = 0;
    for (const invoice of uniqueInvoices(invoices)) {
        if (invoice.status != null && SKIPPED.has(invoice.status)) continue;
        paidCents += invoice.amountPaidCents;
        chargeCents += invoice.amountPaidCents + invoice.amountRemainingCents;
    }
    if (chargeCents <= 0) return null;
    return paidCents / chargeCents;
}

function effort(calls: readonly ICallTiming[], invoices: readonly ISyncedInvoice[] | null): {
    medianResolutionMinutes: number | null;
    averageTouches: number | null;
} {
    const paidCash = new Set<string>();
    if (invoices) {
        for (const invoice of uniqueInvoices(invoices)) {
            if (invoice.status === "paid" && invoice.amountPaidCents > 0) paidCash.add(invoice.id);
        }
    }

    const groups = new Map<string, ICallTiming[]>();
    for (const call of calls) {
        if (!call.invoiceId) continue;
        const group = groups.get(call.invoiceId);
        if (group) group.push(call);
        else groups.set(call.invoiceId, [call]);
    }

    const touches: number[] = [];
    const minutes: number[] = [];
    for (const [invoiceId, group] of groups) {
        if (!group.some((call) => call.status === "paid") && !paidCash.has(invoiceId)) continue;
        touches.push(group.length);

        let start = Infinity;
        let end = -Infinity;
        for (const call of group) {
            const began = timestamp(call.startedAt) ?? timestamp(call.createdAt);
            if (began != null && began < start) start = began;
            // ponytail: ends at the paid call. Use invoice paid_at if sync exposes it.
            if (call.status !== "paid") continue;
            const finished = timestamp(call.endedAt) ?? timestamp(call.startedAt);
            if (finished != null && finished > end) end = finished;
        }
        if (start !== Infinity && end !== -Infinity && end >= start) {
            minutes.push((end - start) / 60_000);
        }
    }

    return {
        medianResolutionMinutes: median(minutes),
        averageTouches: touches.length === 0
            ? null
            : touches.reduce((sum, count) => sum + count, 0) / touches.length,
    };
}

function uniqueInvoices(invoices: readonly ISyncedInvoice[]): ISyncedInvoice[] {
    const seen = new Set<string>();
    const rows: ISyncedInvoice[] = [];
    for (const invoice of invoices) {
        if (seen.has(invoice.id)) continue;
        seen.add(invoice.id);
        rows.push(invoice);
    }
    return rows;
}

/** Dollars paid, still overdue, promised, and collection effort. Null money means sync is missing. */
export function homeMetrics(input: {
    invoices: readonly ISyncedInvoice[] | null;
    calls: readonly ICallTiming[];
    nowUnix: number;
}): IHomeMetrics {
    const pace = effort(input.calls, input.invoices);
    if (input.invoices == null || input.invoices.length === 0) {
        return { recovered: null, stillOverdue: null, promised: null, collectionRate: null, ...pace };
    }

    let paidCents = 0;
    let overdueCents = 0;
    let promisedCents = 0;
    for (const invoice of uniqueInvoices(input.invoices)) {
        if (invoice.status != null && SKIPPED.has(invoice.status)) continue;
        paidCents += invoice.amountPaidCents;
        const due = invoice.dueDateUnix == null || invoice.dueDateUnix <= input.nowUnix;
        if (invoice.status === "uncollectible" || (invoice.status === "open" && due)) {
            overdueCents += invoice.amountRemainingCents;
        } else if (invoice.status === "open") {
            promisedCents += invoice.amountRemainingCents;
        }
    }

    return {
        recovered: paidCents / 100,
        stillOverdue: overdueCents / 100,
        promised: promisedCents / 100,
        collectionRate: collectionRate(input.invoices),
        ...pace,
    };
}

interface ICallMoneyRow {
    stripe_invoice_id: string;
    status?: string | null;
    started_at: string | null;
    ended_at: string | null;
    created_at?: string | null;
}

interface IStripeInvoiceRow {
    id: string;
    amount_paid: number | string | null;
    amount_remaining: number | string | null;
    status: string | null;
    due_date: number | string | null;
    metadata: unknown;
}

function cents(value: number | string | null | undefined): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
}

function installmentIds(metadata: unknown): string[] {
    if (!metadata || typeof metadata !== "object") return [];
    const raw = (metadata as Record<string, unknown>).scamlord_installment_invoice_ids;
    if (typeof raw !== "string") return [];
    return raw.split(",").map((id) => id.trim()).filter(Boolean);
}

function toSynced(row: IStripeInvoiceRow): ISyncedInvoice {
    const due = row.due_date == null ? null : Number(row.due_date);
    return {
        id: row.id,
        amountPaidCents: cents(row.amount_paid),
        amountRemainingCents: cents(row.amount_remaining),
        status: row.status,
        dueDateUnix: due != null && Number.isFinite(due) ? due : null,
    };
}

async function readInvoices(supabase: SupabaseClient, ids: string[]): Promise<IStripeInvoiceRow[] | null> {
    // ponytail: one .in() for the portfolio; chunk ids if a landlord exceeds PostgREST URL limits.
    const { data, error } = await supabase
        .schema("stripe")
        .from("invoices")
        .select("id, amount_paid, amount_remaining, status, due_date, metadata")
        .in("id", ids);
    if (error) return null;
    return (data ?? []) as IStripeInvoiceRow[];
}

/** Synced payment totals for the signed-in landlord. Missing sync tables come back blank, not thrown. */
export async function loadHomeMetrics(supabase: SupabaseClient, now = new Date()): Promise<IHomeMetrics> {
    const nowUnix = Math.floor(now.getTime() / 1000);
    const { data, error } = await supabase
        .from("calls")
        .select("stripe_invoice_id, status, started_at, ended_at, created_at");
    if (error || !data) {
        return {
            recovered: null,
            stillOverdue: null,
            promised: null,
            collectionRate: null,
            medianResolutionMinutes: null,
            averageTouches: null,
        };
    }

    const rows = data as ICallMoneyRow[];
    const calls = rows.map((row) => ({
        invoiceId: row.stripe_invoice_id,
        status: row.status ?? null,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        createdAt: row.created_at ?? null,
    }));
    const ids = [...new Set(rows.map((row) => row.stripe_invoice_id).filter(Boolean))];
    if (ids.length === 0) return homeMetrics({ invoices: [], calls, nowUnix });

    const invoices = await readInvoices(supabase, ids);
    if (!invoices) return homeMetrics({ invoices: null, calls, nowUnix });

    const seen = new Set(invoices.map((row) => row.id));
    const extra: string[] = [];
    for (const row of invoices) {
        for (const id of installmentIds(row.metadata)) {
            if (seen.has(id)) continue;
            seen.add(id);
            extra.push(id);
        }
    }
    let synced = invoices;
    if (extra.length > 0) {
        const linked = await readInvoices(supabase, extra);
        if (!linked) return homeMetrics({ invoices: null, calls, nowUnix });
        synced = invoices.concat(linked);
    }

    return homeMetrics({
        invoices: synced.map(toSynced),
        calls,
        nowUnix,
    });
}
