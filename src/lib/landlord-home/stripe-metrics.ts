/**
 * @module landlord-home/stripe-metrics
 * Recovered, still overdue, promised, and median minutes from Stripe Sync invoices.
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
    startedAt: string | null;
    endedAt: string | null;
}

export interface IHomeMetrics {
    recovered: number | null;
    stillOverdue: number | null;
    promised: number | null;
    medianMinutes: number | null;
}

const SKIPPED = new Set(["void", "draft"]);

function medianMinutes(calls: readonly ICallTiming[]): number | null {
    const minutes: number[] = [];
    for (const call of calls) {
        if (!call.startedAt || !call.endedAt) continue;
        const started = Date.parse(call.startedAt);
        const ended = Date.parse(call.endedAt);
        if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) continue;
        minutes.push((ended - started) / 60_000);
    }
    if (minutes.length === 0) return null;
    minutes.sort((a, b) => a - b);
    const mid = Math.floor(minutes.length / 2);
    return minutes.length % 2 === 1 ? minutes[mid] : (minutes[mid - 1] + minutes[mid]) / 2;
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

/** Dollars paid, still overdue, promised, and median call minutes. Null money means sync is missing. */
export function homeMetrics(input: {
    invoices: readonly ISyncedInvoice[] | null;
    calls: readonly ICallTiming[];
    nowUnix: number;
}): IHomeMetrics {
    if (input.invoices == null || input.invoices.length === 0) {
        return { recovered: null, stillOverdue: null, promised: null, medianMinutes: medianMinutes(input.calls) };
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
        medianMinutes: medianMinutes(input.calls),
    };
}

interface ICallMoneyRow {
    stripe_invoice_id: string;
    started_at: string | null;
    ended_at: string | null;
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
        .select("stripe_invoice_id, started_at, ended_at");
    if (error || !data) {
        return { recovered: null, stillOverdue: null, promised: null, medianMinutes: null };
    }

    const rows = data as ICallMoneyRow[];
    const calls = rows.map((row) => ({ startedAt: row.started_at, endedAt: row.ended_at }));
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
