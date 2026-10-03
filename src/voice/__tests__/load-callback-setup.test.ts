import { describe, expect, it, vi } from "vitest";

import { getDemoCallContext } from "@/voice/demo-context";
import { loadCallbackSetup, type TInvoiceSnapshot } from "@/voice/load-call-context";
import type { TVoiceSupabaseClient } from "@/voice/supabase-client";

const TENANCY_ID = "a4444444-4444-4444-8444-444444444401";
const LANDLORD_ID = "a1111111-1111-4111-8111-111111111101";

type TTableResult = { data: unknown; error: { message: string } | null };

function asDb(mock: unknown): TVoiceSupabaseClient {
    return mock as TVoiceSupabaseClient;
}

/**
 * Chainable PostgREST stand-in: every filter returns the builder; `maybeSingle()` and `await`
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
            in: () => builder,
            order: () => builder,
            limit: () => builder,
            maybeSingle: () => Promise.resolve(result),
            then: (resolve: (value: TTableResult) => unknown) => Promise.resolve(result).then(resolve),
        };
        return builder;
    });
    return { from };
}

const PRIOR_TRANSCRIPT = Array.from({ length: 14 }, (_, i) => (i % 2 ? `Tenant: line ${i}` : `Agent: line ${i}`)).join("\n");

function seededDb(calls: unknown[]): Record<string, TTableResult> {
    return {
        tenancies: {
            data: {
                id: TENANCY_ID,
                name: "Jordan Lee",
                phone: "+15555550201",
                email: "jordan.lee@example.com",
                stripe_customer_id: "cus_jordan",
                units: { label: "Unit 2B", properties: { name: "Maple Court", landlord_id: LANDLORD_ID } },
            },
            error: null,
        },
        policies: { data: { max_installments: 2, grace_days: 14, fee_waiver_cap: 25 }, error: null },
        perks: { data: [], error: null },
        landlords: { data: { stripe_connected_account_id: null }, error: null },
        calls: { data: calls, error: null },
    };
}

const PRIOR_CALL = {
    channel: "outbound_call",
    status: "in_progress",
    handoff_reason: null,
    transcript: PRIOR_TRANSCRIPT,
    stripe_invoice_id: "in_prior",
    created_at: "2026-10-03T19:20:08Z",
};

const INVOICE: TInvoiceSnapshot = { invoiceId: "in_prior", openBalance: 1250, dueDate: "2026-09-30" };
const quietLog = { warn: vi.fn() };

describe("loadCallbackSetup", () => {
    it("builds a known caller's context from Supabase and the last call's Stripe invoice", async () => {
        const fetchInvoice = vi.fn(async () => INVOICE);

        const setup = await loadCallbackSetup("+15555550201", {
            client: asDb(mockDb(seededDb([PRIOR_CALL]))),
            fetchInvoice,
            log: quietLog,
        });

        expect(fetchInvoice).toHaveBeenCalledWith({ invoiceId: "in_prior", customerId: "cus_jordan" });
        expect(setup.kind).toBe("known");
        if (setup.kind !== "known") {
            return;
        }
        expect(setup.tenancyId).toBe(TENANCY_ID);
        expect(setup.callContext).toMatchObject({
            tenantName: "Jordan Lee",
            propertyName: "Maple Court",
            phone: "+15555550201",
            openBalance: 1250,
            invoiceDueDate: "2026-09-30",
            stripeInvoiceId: "in_prior",
            policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 25 },
        });
        expect(setup.handoff).toEqual({ active: false, reason: null });
    });

    it("summarises the last ten lines of the previous conversation", async () => {
        const setup = await loadCallbackSetup("+15555550201", {
            client: asDb(mockDb(seededDb([PRIOR_CALL]))),
            fetchInvoice: async () => INVOICE,
            log: quietLog,
        });

        const summary = setup.kind === "known" ? setup.priorConversation ?? "" : "";
        expect(summary).toContain("Tenant: line 13");
        expect(summary).toContain("Agent: line 4");
        expect(summary).not.toContain("Agent: line 2\n");
        expect(summary.split("\n").filter((line) => /^(Agent|Tenant):/.test(line))).toHaveLength(10);
    });

    it("carries an earlier handoff into the callback", async () => {
        const handedOff = { ...PRIOR_CALL, status: "waiting_on_person", handoff_reason: "hardship" };

        const setup = await loadCallbackSetup("+15555550201", {
            client: asDb(mockDb(seededDb([handedOff, PRIOR_CALL]))),
            fetchInvoice: async () => INVOICE,
            log: quietLog,
        });

        expect(setup.kind === "known" && setup.handoff).toEqual({ active: true, reason: "hardship" });
    });

    it("falls back to the demo invoice when Stripe has nothing and there is no earlier call", async () => {
        const fetchInvoice = vi.fn(async () => null);

        const setup = await loadCallbackSetup("+15555550201", {
            client: asDb(mockDb(seededDb([]))),
            fetchInvoice,
            log: quietLog,
        });

        const demo = getDemoCallContext();
        expect(fetchInvoice).toHaveBeenCalledWith({ invoiceId: null, customerId: "cus_jordan" });
        expect(setup.kind === "known" && setup.callContext).toMatchObject({
            tenantName: "Jordan Lee",
            openBalance: demo.openBalance,
            stripeInvoiceId: demo.stripeInvoiceId,
        });
        expect(setup.kind === "known" && setup.priorConversation).toBeNull();
    });

    it("treats a number with no tenancy as an unknown caller", async () => {
        const setup = await loadCallbackSetup("+15555559999", {
            client: asDb(mockDb({ tenancies: { data: null, error: null } })),
            fetchInvoice: async () => INVOICE,
            log: quietLog,
        });

        expect(setup).toEqual({ kind: "unknown", phoneNumber: "+15555559999" });
    });

    it("treats a hidden number as unknown without querying Supabase", async () => {
        const db = mockDb(seededDb([PRIOR_CALL]));

        const setup = await loadCallbackSetup(null, { client: asDb(db), log: quietLog });

        expect(setup).toEqual({ kind: "unknown", phoneNumber: null });
        expect(db.from).not.toHaveBeenCalled();
    });

    it("treats the caller as unknown when Supabase fails, so no account details leak", async () => {
        const setup = await loadCallbackSetup("+15555550201", {
            client: asDb(mockDb({ tenancies: { data: null, error: { message: "boom" } } })),
            log: quietLog,
        });

        expect(setup.kind).toBe("unknown");
    });
});
