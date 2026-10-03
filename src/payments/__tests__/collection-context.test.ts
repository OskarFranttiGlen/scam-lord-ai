// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { getDemoCallContext } from "@/voice/context";
import { buildCollectionCallRequest } from "../collection-context";
import { createSupabaseMock } from "./supabase-mock";

function asInvoice(value: unknown): Stripe.Invoice {
    return value as Stripe.Invoice;
}

const overdue = asInvoice({
    id: "in_overdue",
    customer: "cus_jordan",
    customer_name: "Stripe Name",
    customer_phone: "+15550000000",
    customer_email: "stripe@example.com",
    amount_remaining: 184000,
    due_date: Date.UTC(2026, 8, 28, 12) / 1000,
    created: Date.UTC(2026, 8, 1) / 1000,
    metadata: {},
});

describe("buildCollectionCallRequest", () => {
    it("uses the Supabase tenancy, policy, perks, and connected account", async () => {
        const { db, calls } = createSupabaseMock({
            tenancies: {
                data: {
                    id: "ten_1",
                    name: "Jordan Lee",
                    phone: "+15555550102",
                    email: "jordan@example.com",
                    units: { label: "Unit 2B", properties: { name: "Maple Court", landlord_id: "ll_1" } },
                },
                error: null,
            },
            policies: { data: { max_installments: 3, grace_days: 10, fee_waiver_cap: "50.00" }, error: null },
            perks: { data: [{ id: "perk_1", body: "We'll mow the lawn", condition_text: "pay today" }], error: null },
            landlords: { data: { stripe_connected_account_id: "acct_landlord" }, error: null },
        });

        const request = await buildCollectionCallRequest({ invoice: overdue, db });

        expect(request).toEqual({
            toPhoneNumber: "+15555550102",
            tenancyId: "ten_1",
            connectedAccountId: "acct_landlord",
            source: "supabase",
            callContext: {
                tenantName: "Jordan Lee",
                propertyName: "Maple Court",
                unitLabel: "Unit 2B",
                phone: "+15555550102",
                email: "jordan@example.com",
                openBalance: 1840,
                invoiceDueDate: "2026-09-28",
                policy: { maxInstallments: 3, graceDays: 10, feeWaiverCap: 50 },
                perks: [{ id: "perk_1", description: "We'll mow the lawn", condition: "pay today" }],
                stripeInvoiceId: "in_overdue",
            },
        });
        expect(calls).toContainEqual({ table: "tenancies", method: "eq", args: ["stripe_customer_id", "cus_jordan"] });
    });

    it("looks up by scamlord_tenancy_id metadata when present", async () => {
        const { db, calls } = createSupabaseMock({});

        await buildCollectionCallRequest({
            invoice: asInvoice({ ...overdue, metadata: { scamlord_tenancy_id: "ten_9" } }),
            db,
            log: { warn: vi.fn() },
        });

        expect(calls).toContainEqual({ table: "tenancies", method: "eq", args: ["id", "ten_9"] });
    });

    it("falls back to Stripe contact details and demo policy when no tenancy matches", async () => {
        const demo = getDemoCallContext();

        const request = await buildCollectionCallRequest({ invoice: overdue, db: null });

        expect(request.source).toBe("demo_fallback");
        expect(request.toPhoneNumber).toBe("+15550000000");
        expect(request.callContext).toMatchObject({
            tenantName: "Stripe Name",
            email: "stripe@example.com",
            propertyName: demo.propertyName,
            policy: demo.policy,
            perks: demo.perks,
            openBalance: 1840,
            stripeInvoiceId: "in_overdue",
        });
    });

    it("falls back when the tenancy query errors", async () => {
        const warn = vi.fn();
        const { db } = createSupabaseMock({
            tenancies: { data: null, error: { message: "relation \"tenancies\" does not exist" } },
        });

        const request = await buildCollectionCallRequest({ invoice: overdue, db, log: { warn } });

        expect(request.source).toBe("demo_fallback");
        expect(warn).toHaveBeenCalled();
    });
});
