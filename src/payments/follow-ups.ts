/**
 * @module payments/follow-ups
 *
 * Scheduled follow-up calls (docs/SPEC.md → Call, Follow-up calls). After each call the
 * tenant's promised payment dates live in `calls.ai_notes`; when a promise passes unpaid and
 * no call has gone out since, the run dials the tenancy again. Every dial reuses the webhook's
 * `startCallForInvoice`, so the same Stripe and office-task safety checks apply, and the run
 * only happens inside calling hours.
 *
 * Depends on: @supabase/supabase-js, zod, ./webhook-events
 * Used by: /api/cron/follow-ups
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { startCallForInvoice, type TStripeWebhookDeps, type TStripeWebhookOutcome } from "./webhook-events";

/** How far back the scan reads noted calls. */
const LOOKBACK_DAYS = 14;
/** Most dials one cron run places. */
const MAX_CALLS_PER_RUN = 10;
/** Upper bound on tenancies the scan reads, newest calls first. */
const SCAN_LIMIT = 500;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Only the promises are needed here; summary and flags stay with the voice layer. */
const notesSchema = z.object({
    promises: z.array(z.object({ date: z.string() })),
});

export type TDueFollowUp = {
    tenancyId: string;
    /** Invoice of the tenancy's latest call; the follow-up dials about it. */
    stripeInvoiceId: string;
    /** Newest promised date that passed with no call after it (YYYY-MM-DD). */
    missedDate: string;
};

/**
 * True Monday–Saturday between 09:00 and 19:59 local time; never Sunday.
 *
 * @param now - Current time
 * @param timeZone - IANA zone; defaults to `CALLING_TIME_ZONE` or America/Los_Angeles
 */
export function isWithinCallingHours(
    now: Date,
    timeZone: string = process.env.CALLING_TIME_ZONE || "America/Los_Angeles",
): boolean {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" })
        .formatToParts(now);
    const weekday = parts.find(part => part.type === "weekday")?.value;
    const hour = Number(parts.find(part => part.type === "hour")?.value);
    if (weekday === "Sun" || !Number.isInteger(hour)) {
        return false;
    }
    return hour >= 9 && hour <= 19;
}

type TNotedCallRow = {
    tenancy_id: string;
    stripe_invoice_id: string;
    created_at: string;
    ai_notes: unknown;
};

function promisesOf(aiNotes: unknown): string[] | null {
    const parsed = notesSchema.safeParse(aiNotes);
    return parsed.success ? parsed.data.promises.map(promise => promise.date) : null;
}

function nextDay(date: string): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Tenancies whose latest call notes promise a payment date that has passed (before `today`)
 * with no call created on or after the day after it, so each missed promise gets one call.
 * Reads the last {@link LOOKBACK_DAYS} days of noted calls, newest first, and never throws.
 *
 * @param db - Service-role Supabase client, or null without Supabase
 * @param today - YYYY-MM-DD
 */
export async function findDueFollowUps(db: SupabaseClient | null, today: string): Promise<TDueFollowUp[]> {
    if (!db) {
        return [];
    }
    const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db
        .from("calls")
        .select("tenancy_id, stripe_invoice_id, created_at, ai_notes")
        .not("ai_notes", "is", null)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(SCAN_LIMIT);
    if (error || !Array.isArray(data)) {
        return [];
    }
    const rows = data as TNotedCallRow[];

    const byTenancy = new Map<string, Array<{ row: TNotedCallRow; promises: string[] | null }>>();
    for (const row of rows) {
        const calls = byTenancy.get(row.tenancy_id) ?? [];
        calls.push({ row, promises: promisesOf(row.ai_notes) });
        byTenancy.set(row.tenancy_id, calls);
    }

    const due: TDueFollowUp[] = [];
    for (const [tenancyId, calls] of byTenancy) {
        const latest = calls[0];
        if (!latest.promises) {
            continue;
        }
        const missed = latest.promises.filter(date => ISO_DATE.test(date) && date < today).sort();
        const missedDate = missed.at(-1);
        if (!missedDate) {
            continue;
        }
        const handledFrom = nextDay(missedDate);
        const handled = calls.some(({ row }) => row.created_at.slice(0, 10) >= handledFrom);
        if (!handled) {
            due.push({ tenancyId, stripeInvoiceId: latest.row.stripe_invoice_id, missedDate });
        }
    }
    return due;
}

export type TFollowUpDeps = TStripeWebhookDeps & {
    /** Clock override for tests. */
    now?: Date;
};

export type TFollowUpRunSummary = {
    /** Present when the run dialed nothing because it was outside calling hours. */
    skipped?: "outside_calling_hours";
    /** Tenancies with a passed promise and no call since. */
    due: number;
    /** Calls actually placed. */
    started: number;
    outcomes: TStripeWebhookOutcome[];
};

/**
 * Dials every tenancy with a passed, un-followed-up promise, inside calling hours only.
 * Each dial re-runs the webhook's safety checks through `startCallForInvoice`; one item
 * failing never stops the run, and at most {@link MAX_CALLS_PER_RUN} calls go out per run.
 *
 * @param deps - Stripe client, optional Supabase client, call starter, logger, clock override
 */
export async function runFollowUps(deps: TFollowUpDeps): Promise<TFollowUpRunSummary> {
    const log = deps.log ?? console;
    const now = deps.now ?? new Date();
    if (!isWithinCallingHours(now)) {
        return { skipped: "outside_calling_hours", due: 0, started: 0, outcomes: [] };
    }
    const today = now.toISOString().slice(0, 10);

    let due: TDueFollowUp[] = [];
    try {
        due = await findDueFollowUps(deps.db, today);
    } catch (error) {
        log.error("[follow-ups] due lookup failed", error);
    }

    const outcomes: TStripeWebhookOutcome[] = [];
    let started = 0;
    for (const item of due.slice(0, MAX_CALLS_PER_RUN)) {
        try {
            const invoice = await deps.stripe.invoices.retrieve(item.stripeInvoiceId);
            const outcome = await startCallForInvoice(invoice, deps);
            outcomes.push(outcome);
            if (outcome.action === "call_started") {
                started += 1;
            }
        } catch (error) {
            log.error("[follow-ups] follow-up failed", {
                tenancyId: item.tenancyId,
                invoiceId: item.stripeInvoiceId,
                error,
            });
            outcomes.push({ action: "skipped", reason: `follow-up for ${item.stripeInvoiceId} failed: ${String(error)}` });
        }
    }
    return { due: due.length, started, outcomes };
}