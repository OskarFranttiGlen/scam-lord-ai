/**
 * @vitest-environment node
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { findDueFollowUps, isWithinCallingHours, runFollowUps, type TFollowUpDeps } from "../follow-ups";

type TTableResult = { data: unknown; error: { message: string } | null };

function asStripe(value: unknown): Stripe {
    return value as Stripe;
}

function asSupabaseClient(value: unknown): SupabaseClient {
    return value as SupabaseClient;
}

function notes(promises: Array<{ date: string; amount?: number | null }>) {
    return {
        summary: "Tenant promised a date.",
        promises: promises.map(promise => ({ amount: null, source: "verbal", ...promise })),
        flags: [],
    };
}

function callRow(overrides: Record<string, unknown> = {}) {
    return {
        tenancy_id: "ten_1",
        stripe_invoice_id: "in_due",
        created_at: "2026-09-29T18:00:00+00:00",
        ai_notes: notes([{ date: "2026-09-30", amount: 1840 }]),
        ...overrides,
    };
}

/**
 * Fake Supabase client for the follow-up flow: the notes scan on `calls` resolves to `scan`,
 * the active-call check (`select("id")`) resolves to `active`, and every other table resolves
 * empty.
 *
 * @param scan - Rows (or error) the follow-up scan sees
 * @param active - Rows the active-call check sees
 */
function createCallsDb(scan: TTableResult, active: TTableResult = { data: [], error: null }) {
    const from = vi.fn((table: string) => {
        let result: TTableResult = table === "calls" ? scan : { data: null, error: null };
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "not", "gte", "in", "order", "limit", "update"]) {
            builder[method] = (...args: unknown[]) => {
                if (table === "calls" && method === "select" && args[0] === "id") {
                    result = active;
                }
                return builder;
            };
        }
        builder.maybeSingle = async () => result;
        builder.then = (resolve: (value: TTableResult) => unknown) => Promise.resolve(result).then(resolve);
        return builder;
    });
    const db: unknown = { from };
    return { db: asSupabaseClient(db), from };
}

function openInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: "in_due",
        status: "open",
        customer: "cus_jordan",
        customer_name: "Jordan Lee",
        customer_phone: "+15555550102",
        customer_email: "jordan@example.com",
        amount_remaining: 184000,
        amount_paid: 0,
        due_date: Date.UTC(2026, 8, 28) / 1000,
        created: Date.UTC(2026, 8, 1) / 1000,
        metadata: {},
        ...overrides,
    };
}

/** Thursday 10:00 a.m. in Los Angeles. */
const IN_HOURS = new Date("2026-10-01T17:00:00.000Z");

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("isWithinCallingHours", () => {
    it.each([
        ["Thursday 10:00 a.m. in LA", "2026-10-01T17:00:00.000Z", true],
        ["Tuesday 9:00 a.m. in LA", "2026-10-06T16:00:00.000Z", true],
        ["Saturday 11:00 a.m. in LA", "2026-10-03T18:00:00.000Z", true],
        ["Tuesday 8:59 a.m. in LA", "2026-10-06T15:59:00.000Z", false],
        ["Wednesday 8:30 p.m. in LA", "2026-10-01T03:30:00.000Z", false],
        ["Sunday noon in LA", "2026-10-04T19:00:00.000Z", false],
    ])("is %s -> %s", (_label, iso, expected) => {
        expect(isWithinCallingHours(new Date(iso))).toBe(expected);
    });

    it("honors CALLING_TIME_ZONE over the LA default", () => {
        vi.stubEnv("CALLING_TIME_ZONE", "America/New_York");
        try {
            // 9:00 a.m. in New York is 6:00 a.m. in Los Angeles.
            expect(isWithinCallingHours(new Date("2026-10-01T13:00:00.000Z"))).toBe(true);
        } finally {
            vi.unstubAllEnvs();
        }
        expect(isWithinCallingHours(new Date("2026-10-01T13:00:00.000Z"))).toBe(false);
    });
});

describe("findDueFollowUps", () => {
    it("returns the tenancy, latest invoice, and missed date when a promise passed with no call after it", async () => {
        const { db, from } = createCallsDb({ data: [callRow()], error: null });

        const due = await findDueFollowUps(db, "2026-10-03");

        expect(due).toEqual([{ tenancyId: "ten_1", stripeInvoiceId: "in_due", missedDate: "2026-09-30" }]);
        expect(from).toHaveBeenCalledWith("calls");
    });

    it("skips promises that have not passed yet", async () => {
        const { db } = createCallsDb({
            data: [callRow({ ai_notes: notes([{ date: "2026-10-03" }, { date: "2026-10-10" }]) })],
            error: null,
        });

        expect(await findDueFollowUps(db, "2026-10-03")).toEqual([]);
    });

    it("does not call twice for the same missed promise", async () => {
        // The follow-up call itself went out the day after the promise passed.
        const { db } = createCallsDb({
            data: [
                callRow({ created_at: "2026-10-01T15:00:00+00:00" }),
                callRow({ created_at: "2026-09-29T18:00:00+00:00" }),
            ],
            error: null,
        });

        expect(await findDueFollowUps(db, "2026-10-03")).toEqual([]);
    });

    it("follows up again when a newer promise also passes", async () => {
        // The Oct 1 follow-up call promised Oct 5; both promises sit in the latest notes.
        const { db } = createCallsDb({
            data: [callRow({
                created_at: "2026-10-01T15:00:00+00:00",
                ai_notes: notes([{ date: "2026-09-30" }, { date: "2026-10-05" }]),
            })],
            error: null,
        });

        expect(await findDueFollowUps(db, "2026-10-06")).toEqual([
            { tenancyId: "ten_1", stripeInvoiceId: "in_due", missedDate: "2026-10-05" },
        ]);
    });

    it("dials about the latest call's invoice", async () => {
        const { db } = createCallsDb({
            data: [
                callRow({
                    created_at: "2026-10-01T20:00:00+00:00",
                    stripe_invoice_id: "in_latest",
                    ai_notes: notes([{ date: "2026-10-01" }]),
                }),
                callRow({
                    created_at: "2026-09-25T18:00:00+00:00",
                    stripe_invoice_id: "in_old",
                    ai_notes: notes([{ date: "2026-10-01" }]),
                }),
            ],
            error: null,
        });

        expect(await findDueFollowUps(db, "2026-10-03")).toEqual([
            { tenancyId: "ten_1", stripeInvoiceId: "in_latest", missedDate: "2026-10-01" },
        ]);
    });

    it("keeps tenancies separate", async () => {
        const { db } = createCallsDb({
            data: [
                callRow({ tenancy_id: "ten_fine", ai_notes: notes([{ date: "2026-10-05" }]) }),
                callRow({ tenancy_id: "ten_due" }),
            ],
            error: null,
        });

        expect(await findDueFollowUps(db, "2026-10-03")).toEqual([
            { tenancyId: "ten_due", stripeInvoiceId: "in_due", missedDate: "2026-09-30" },
        ]);
    });

    it("skips a tenancy whose latest notes do not parse", async () => {
        const { db } = createCallsDb({ data: [callRow({ ai_notes: { promises: "not an array" } })], error: null });

        expect(await findDueFollowUps(db, "2026-10-03")).toEqual([]);
    });

    it("returns nothing when the query fails or there is no database", async () => {
        const failed = createCallsDb({ data: null, error: { message: "relation \"calls\" does not exist" } });

        expect(await findDueFollowUps(failed.db, "2026-10-03")).toEqual([]);
        expect(await findDueFollowUps(null, "2026-10-03")).toEqual([]);
    });
});

describe("runFollowUps", () => {
    it("starts a call for a due open invoice", async () => {
        const retrieve = vi.fn(async () => openInvoice());
        const startCollectionCall = vi.fn(async () => ({ roomName: "follow-up-room-1" }));
        const deps: TFollowUpDeps = {
            stripe: asStripe({ invoices: { retrieve, list: vi.fn(async () => ({ data: [] })) } }),
            db: createCallsDb({ data: [callRow()], error: null }).db,
            startCollectionCall,
            log: silent,
            now: IN_HOURS,
        };

        const summary = await runFollowUps(deps);

        expect(summary).toEqual({
            due: 1,
            started: 1,
            outcomes: [{ action: "call_started", invoiceId: "in_due", roomName: "follow-up-room-1", source: "demo_fallback" }],
        });
        expect(retrieve).toHaveBeenCalledWith("in_due");
        expect(startCollectionCall).toHaveBeenCalledWith(expect.objectContaining({ toPhoneNumber: "+15555550102" }));
    });

    it("skips the whole run outside calling hours", async () => {
        const { db, from } = createCallsDb({ data: [callRow()], error: null });
        const startCollectionCall = vi.fn();
        const deps: TFollowUpDeps = {
            stripe: asStripe({}),
            db,
            startCollectionCall,
            log: silent,
            now: new Date("2026-10-04T19:00:00.000Z"), // Sunday noon in LA
        };

        const summary = await runFollowUps(deps);

        expect(summary).toEqual({ skipped: "outside_calling_hours", due: 0, started: 0, outcomes: [] });
        expect(from).not.toHaveBeenCalled();
        expect(startCollectionCall).not.toHaveBeenCalled();
    });

    it("skips a passed promise whose invoice has since been paid", async () => {
        const retrieve = vi.fn(async () => openInvoice({ status: "paid", amount_paid: 184000, amount_remaining: 0 }));
        const startCollectionCall = vi.fn();
        const deps: TFollowUpDeps = {
            stripe: asStripe({ invoices: { retrieve, list: vi.fn(async () => ({ data: [] })) } }),
            db: createCallsDb({ data: [callRow()], error: null }).db,
            startCollectionCall,
            log: silent,
            now: IN_HOURS,
        };

        const summary = await runFollowUps(deps);

        expect(summary).toEqual({
            due: 1,
            started: 0,
            outcomes: [{ action: "skipped", reason: "invoice is paid" }],
        });
        expect(startCollectionCall).not.toHaveBeenCalled();
    });

    it("keeps going when one invoice lookup fails", async () => {
        const retrieve = vi.fn(async (invoiceId: string) => {
            if (invoiceId === "in_a") {
                throw new Error("stripe is down");
            }
            return openInvoice({ id: invoiceId });
        });
        const startCollectionCall = vi.fn(async () => ({ roomName: "follow-up-room-2" }));
        const deps: TFollowUpDeps = {
            stripe: asStripe({ invoices: { retrieve, list: vi.fn(async () => ({ data: [] })) } }),
            db: createCallsDb({
                data: [
                    callRow({ tenancy_id: "ten_a", stripe_invoice_id: "in_a" }),
                    callRow({ tenancy_id: "ten_b", stripe_invoice_id: "in_b" }),
                ],
                error: null,
            }).db,
            startCollectionCall,
            log: silent,
            now: IN_HOURS,
        };

        const summary = await runFollowUps(deps);

        expect(summary.due).toBe(2);
        expect(summary.started).toBe(1);
        expect(summary.outcomes[0]).toMatchObject({ action: "skipped", reason: expect.stringContaining("in_a") });
        expect(summary.outcomes[1]).toEqual({
            action: "call_started",
            invoiceId: "in_b",
            roomName: "follow-up-room-2",
            source: "demo_fallback",
        });
        expect(silent.error).toHaveBeenCalled();
    });

    it("caps the run at ten calls", async () => {
        const rows = Array.from({ length: 12 }, (_, index) =>
            callRow({ tenancy_id: `ten_${index}`, stripe_invoice_id: `in_${index}` }));
        const retrieve = vi.fn(async (invoiceId: string) =>
            openInvoice({ id: invoiceId, status: "paid", amount_paid: 184000, amount_remaining: 0 }));
        const startCollectionCall = vi.fn();
        const deps: TFollowUpDeps = {
            stripe: asStripe({ invoices: { retrieve } }),
            db: createCallsDb({ data: rows, error: null }).db,
            startCollectionCall,
            log: silent,
            now: IN_HOURS,
        };

        const summary = await runFollowUps(deps);

        expect(summary.due).toBe(12);
        expect(summary.outcomes).toHaveLength(10);
        expect(retrieve).toHaveBeenCalledTimes(10);
        expect(startCollectionCall).not.toHaveBeenCalled();
    });
});