/**
 * Home money from Stripe Sync invoices (ADR 0001 / 05).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { homeMetrics, loadHomeMetrics, type ISyncedInvoice } from "../stripe-metrics";

const NOW = 1_700_000_000;

function invoice(over: Partial<ISyncedInvoice> & Pick<ISyncedInvoice, "id">): ISyncedInvoice {
    return {
        amountPaidCents: 0,
        amountRemainingCents: 0,
        status: "open",
        dueDateUnix: NOW - 86_400,
        ...over,
    };
}

describe("homeMetrics", () => {
    it("recovers dollars actually paid, once per invoice, and ignores void and draft", () => {
        expect(homeMetrics({
            invoices: [
                invoice({ id: "in_paid", status: "paid", amountPaidCents: 184_000 }),
                invoice({ id: "in_partial", amountPaidCents: 5_000, amountRemainingCents: 1_000 }),
                invoice({ id: "in_paid", status: "paid", amountPaidCents: 184_000 }),
                invoice({ id: "in_void", status: "void", amountPaidCents: 9_000 }),
                invoice({ id: "in_draft", status: "draft", amountPaidCents: 4_000 }),
            ],
            calls: [],
            nowUnix: NOW,
        }).recovered).toBe(1890);
    });

    it("counts open and uncollectible balances that are due as still overdue", () => {
        expect(homeMetrics({
            invoices: [
                invoice({ id: "in_late", amountRemainingCents: 10_000, dueDateUnix: NOW - 86_400 }),
                invoice({ id: "in_nodue", amountRemainingCents: 2_000, dueDateUnix: null }),
                invoice({ id: "in_dead", status: "uncollectible", amountRemainingCents: 3_000, dueDateUnix: NOW + 86_400 }),
                invoice({ id: "in_later", amountRemainingCents: 4_000, dueDateUnix: NOW + 86_400 }),
                invoice({ id: "in_paid", status: "paid", amountRemainingCents: 8_000 }),
                invoice({ id: "in_void", status: "void", amountRemainingCents: 7_000 }),
            ],
            calls: [],
            nowUnix: NOW,
        }).stillOverdue).toBe(150);
    });

    it("counts an open balance due later as promised", () => {
        expect(homeMetrics({
            invoices: [
                invoice({ id: "in_plan", amountRemainingCents: 25_000, dueDateUnix: NOW + 86_400 }),
                invoice({ id: "in_now", amountRemainingCents: 1_000, dueDateUnix: NOW }),
                invoice({ id: "in_paid", status: "paid", amountRemainingCents: 9_000, dueDateUnix: NOW + 86_400 }),
                invoice({ id: "in_dead", status: "uncollectible", amountRemainingCents: 3_000, dueDateUnix: NOW + 86_400 }),
            ],
            calls: [],
            nowUnix: NOW,
        }).promised).toBe(250);
    });

    it("divides rent collected by charges and ignores void, draft, and duplicate invoices", () => {
        expect(homeMetrics({
            invoices: [
                invoice({ id: "in_paid", status: "paid", amountPaidCents: 184_000, amountRemainingCents: 0 }),
                invoice({ id: "in_partial", amountPaidCents: 5_000, amountRemainingCents: 1_000 }),
                invoice({ id: "in_paid", status: "paid", amountPaidCents: 184_000, amountRemainingCents: 0 }),
                invoice({ id: "in_void", status: "void", amountPaidCents: 9_000, amountRemainingCents: 0 }),
                invoice({ id: "in_draft", status: "draft", amountPaidCents: 4_000, amountRemainingCents: 0 }),
            ],
            calls: [],
            nowUnix: NOW,
        }).collectionRate).toBe(189_000 / 190_000);
    });

    it("reports 0% when charges are open and nothing has been paid", () => {
        expect(homeMetrics({
            invoices: [invoice({ id: "in_late", amountRemainingCents: 10_000 })],
            calls: [],
            nowUnix: NOW,
        }).collectionRate).toBe(0);
    });

    it("uses the median time from the first touch to the paid call, and the mean touches on collected invoices", () => {
        const metrics = homeMetrics({
            invoices: [
                invoice({ id: "in_fast", status: "paid", amountPaidCents: 100 }),
                invoice({ id: "in_slow", status: "open", amountRemainingCents: 100 }),
            ],
            calls: [
                {
                    invoiceId: "in_fast",
                    status: "in_progress",
                    startedAt: "2026-10-03T10:00:00.000Z",
                    endedAt: "2026-10-03T10:10:00.000Z",
                },
                {
                    invoiceId: "in_fast",
                    status: "paid",
                    startedAt: "2026-10-03T11:00:00.000Z",
                    endedAt: "2026-10-03T11:20:00.000Z",
                },
                {
                    invoiceId: "in_slow",
                    status: "paid",
                    startedAt: "2026-10-03T12:00:00.000Z",
                    endedAt: "2026-10-03T14:00:00.000Z",
                },
                {
                    invoiceId: "in_open",
                    status: "in_progress",
                    startedAt: "2026-10-03T15:00:00.000Z",
                    endedAt: "2026-10-03T15:05:00.000Z",
                },
            ],
            nowUnix: NOW,
        });
        expect(metrics.medianResolutionMinutes).toBe(100);
        expect(metrics.averageTouches).toBe(1.5);
    });

    it("leaves money blank when sync is missing and still scores calls already marked paid", () => {
        expect(homeMetrics({
            invoices: null,
            calls: [{
                invoiceId: "in_1",
                status: "paid",
                startedAt: "2026-10-03T10:00:00.000Z",
                endedAt: "2026-10-03T10:10:00.000Z",
            }],
            nowUnix: NOW,
        })).toEqual({
            recovered: null,
            stillOverdue: null,
            promised: null,
            collectionRate: null,
            medianResolutionMinutes: 10,
            averageTouches: 1,
        });
    });
});

function metricsClient(input: {
    calls: { data: unknown[] | null; error: { message: string } | null };
    invoices: (ids: string[]) => { data: unknown[] | null; error: { message: string } | null };
}): SupabaseClient {
    const mock: unknown = {
        from: () => ({
            select: async () => input.calls,
        }),
        schema: () => ({
            from: () => ({
                select: () => ({
                    in: async (_column: string, ids: string[]) => input.invoices(ids),
                }),
            }),
        }),
    };
    return mock as SupabaseClient;
}

describe("loadHomeMetrics", () => {
    it("leaves money blank when the sync tables are missing and does not throw", async () => {
        const now = new Date(NOW * 1000);
        await expect(loadHomeMetrics(metricsClient({
            calls: {
                data: [{
                    stripe_invoice_id: "in_1",
                    started_at: "2026-10-03T10:00:00.000Z",
                    ended_at: "2026-10-03T10:10:00.000Z",
                }],
                error: null,
            },
            invoices: () => ({ data: null, error: { message: "schema stripe not exposed" } }),
        }), now)).resolves.toEqual({
            recovered: null,
            stillOverdue: null,
            promised: null,
            collectionRate: null,
            medianResolutionMinutes: null,
            averageTouches: null,
        });
    });

    it("counts a plan's future installment as promised and cash paid on an installment as recovered", async () => {
        const now = new Date(NOW * 1000);
        await expect(loadHomeMetrics(metricsClient({
            calls: {
                data: [{
                    stripe_invoice_id: "in_original",
                    status: "in_progress",
                    started_at: "2026-10-03T10:00:00.000Z",
                    ended_at: "2026-10-03T10:08:00.000Z",
                }],
                error: null,
            },
            invoices: (ids) => {
                if (ids.includes("in_future")) {
                    return {
                        data: [
                            {
                                id: "in_future",
                                amount_paid: 0,
                                amount_remaining: 25_000,
                                status: "open",
                                due_date: NOW + 86_400,
                                metadata: null,
                            },
                            {
                                id: "in_cash",
                                amount_paid: "5000",
                                amount_remaining: 0,
                                status: "paid",
                                due_date: NOW - 86_400,
                                metadata: null,
                            },
                        ],
                        error: null,
                    };
                }
                return {
                    data: [{
                        id: "in_original",
                        amount_paid: 0,
                        amount_remaining: 0,
                        status: "paid",
                        due_date: NOW - 86_400,
                        metadata: { scamlord_installment_invoice_ids: "in_future, in_cash" },
                    }],
                    error: null,
                };
            },
        }), now)).resolves.toEqual({
            recovered: 50,
            stillOverdue: 0,
            promised: 250,
            collectionRate: 5_000 / 30_000,
            medianResolutionMinutes: null,
            averageTouches: null,
        });
    });
});
