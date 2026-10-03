import { describe, expect, it, vi } from "vitest";

import type { CallContext } from "@/voice/context";
import { getDemoCallContext } from "@/voice/demo-context";
import { loadCallContext, loadCallSetup } from "@/voice/load-call-context";
import type { TVoiceSupabaseClient } from "@/voice/supabase-client";

const TENANCY_ID = "a4444444-4444-4444-8444-444444444401";
const LANDLORD_ID = "a1111111-1111-4111-8111-111111111101";

const METADATA_CONTEXT: CallContext = {
    tenantName: "Riley Judge",
    propertyName: "Oak Terrace",
    unitLabel: "Unit 7",
    phone: "+14155550123",
    email: "riley@example.com",
    openBalance: 950,
    invoiceDueDate: "2026-09-30",
    policy: { maxInstallments: 3, graceDays: 10, feeWaiverCap: 40 },
    perks: [],
    stripeInvoiceId: "in_live_riley",
};

type TTableResult = { data: unknown; error: { message: string } | null };

function asDb(mock: unknown): TVoiceSupabaseClient {
    return mock as TVoiceSupabaseClient;
}

/**
 * Chainable PostgREST stand-in: every filter returns the builder, `maybeSingle()` and `await`
 * resolve to the canned result for that table.
 *
 * @param results - Result per table name
 */
function mockDb(results: Record<string, TTableResult>) {
    const from = vi.fn((table: string) => {
        const result = results[table] ?? { data: null, error: null };
        const builder = {
            select: () => builder,
            eq: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: () => Promise.resolve(result),
            then: (resolve: (value: TTableResult) => unknown) => Promise.resolve(result).then(resolve),
        };
        return builder;
    });
    return { from };
}

const SEEDED_DB = {
    tenancies: {
        data: {
            id: TENANCY_ID,
            name: "Jordan Lee",
            phone: "+15555550201",
            email: "jordan.lee@example.com",
            units: { label: "Unit 2B", properties: { name: "Maple Court", landlord_id: LANDLORD_ID } },
        },
        error: null,
    },
    policies: { data: { max_installments: 2, grace_days: 14, fee_waiver_cap: 25 }, error: null },
    perks: {
        data: [{ id: "perk-1", body: "We'll mow the lawn this weekend.", condition_text: "Pay the open balance today." }],
        error: null,
    },
    landlords: { data: { stripe_connected_account_id: "acct_demo" }, error: null },
};

const quietLog = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

describe("loadCallContext precedence", () => {
    it("uses callContext from room metadata without touching Supabase", async () => {
        const db = mockDb(SEEDED_DB);

        const context = await loadCallContext(
            JSON.stringify({ callContext: METADATA_CONTEXT, tenancyId: TENANCY_ID }),
            { client: asDb(db), log: quietLog },
        );

        expect(context).toEqual(METADATA_CONTEXT);
        expect(db.from).not.toHaveBeenCalled();
    });

    it("loads the tenancy, policy, and perks from Supabase when metadata carries only tenancyId", async () => {
        const db = mockDb(SEEDED_DB);

        const setup = await loadCallSetup(
            JSON.stringify({ tenancyId: TENANCY_ID, stripeInvoiceId: "in_123", openBalance: 1200 }),
            { client: asDb(db), log: quietLog },
        );

        expect(setup.source).toBe("supabase");
        expect(setup.tenancyId).toBe(TENANCY_ID);
        expect(setup.callContext).toMatchObject({
            tenantName: "Jordan Lee",
            propertyName: "Maple Court",
            unitLabel: "Unit 2B",
            phone: "+15555550201",
            email: "jordan.lee@example.com",
            openBalance: 1200,
            stripeInvoiceId: "in_123",
            policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 25 },
            perks: [{
                id: "perk-1",
                description: "We'll mow the lawn this weekend.",
                condition: "Pay the open balance today.",
            }],
        });
    });

    it("falls back to the demo context when the tenancy row is missing", async () => {
        const db = mockDb({ ...SEEDED_DB, tenancies: { data: null, error: null } });

        const setup = await loadCallSetup(JSON.stringify({ tenancyId: TENANCY_ID }), {
            client: asDb(db),
            log: quietLog,
        });

        expect(setup.source).toBe("demo");
        expect(setup.callContext).toEqual(getDemoCallContext());
    });

    it("falls back to the demo context when the Supabase query errors", async () => {
        const db = mockDb({ ...SEEDED_DB, tenancies: { data: null, error: { message: "boom" } } });

        const context = await loadCallContext(JSON.stringify({ tenancyId: TENANCY_ID }), {
            client: asDb(db),
            log: quietLog,
        });

        expect(context).toEqual(getDemoCallContext());
    });

    it("falls back to the demo context when no Supabase client is configured", async () => {
        const setup = await loadCallSetup(JSON.stringify({ tenancyId: TENANCY_ID }), {
            client: null,
            log: quietLog,
        });

        expect(setup.source).toBe("demo");
    });

    it.each([
        ["undefined", undefined],
        ["empty", ""],
        ["not JSON", "{oops"],
        ["unrelated JSON", JSON.stringify({ foo: 1 })],
        ["malformed callContext", JSON.stringify({ callContext: { tenantName: 3 } })],
    ])("falls back to the demo context for %s metadata", async (_label, metadata) => {
        const db = mockDb(SEEDED_DB);

        const setup = await loadCallSetup(metadata, { client: asDb(db), log: quietLog });

        expect(setup.source).toBe("demo");
        expect(setup.callContext).toEqual(getDemoCallContext());
        expect(db.from).not.toHaveBeenCalled();
    });
});
