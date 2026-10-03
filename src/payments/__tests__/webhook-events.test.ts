// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { handleStripeEvent, type TStripeWebhookDeps } from "../webhook-events";
import { createSupabaseMock } from "./supabase-mock";

function asEvent(value: unknown): Stripe.Event {
    return value as Stripe.Event;
}

function asStripe(value: unknown): Stripe {
    return value as Stripe;
}

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function openInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: "in_overdue",
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

function deps(overrides: Partial<TStripeWebhookDeps> = {}): TStripeWebhookDeps {
    return {
        stripe: asStripe({}),
        db: null,
        startCollectionCall: vi.fn(async () => ({ roomName: "collection-room-1" })),
        log: silent,
        ...overrides,
    };
}

describe("handleStripeEvent", () => {
    it.each(["invoice.payment_failed", "invoice.overdue"])("starts a collection call on %s", async type => {
        const d = deps();

        const outcome = await handleStripeEvent(asEvent({ id: "evt_1", type, data: { object: openInvoice() } }), d);

        expect(outcome).toEqual({
            action: "call_started",
            invoiceId: "in_overdue",
            roomName: "collection-room-1",
            source: "demo_fallback",
        });
        expect(d.startCollectionCall).toHaveBeenCalledWith({
            toPhoneNumber: "+15555550102",
            callContext: expect.objectContaining({
                tenantName: "Jordan Lee",
                openBalance: 1840,
                invoiceDueDate: "2026-09-28",
                stripeInvoiceId: "in_overdue",
            }),
        });
    });

    it("fetches the Stripe customer when the invoice has no phone snapshot", async () => {
        const retrieve = vi.fn(async () => ({ id: "cus_jordan", phone: "+15555550199", name: "J", email: null }));
        const d = deps({ stripe: asStripe({ customers: { retrieve } }) });

        await handleStripeEvent(asEvent({
            id: "evt_2",
            type: "invoice.payment_failed",
            data: { object: openInvoice({ customer_phone: null }) },
        }), d);

        expect(retrieve).toHaveBeenCalledWith("cus_jordan");
        expect(d.startCollectionCall).toHaveBeenCalledWith(expect.objectContaining({ toPhoneNumber: "+15555550199" }));
    });

    it("skips invoices already moved into a plan", async () => {
        const d = deps();

        const outcome = await handleStripeEvent(asEvent({
            id: "evt_3",
            type: "invoice.overdue",
            data: { object: openInvoice({ metadata: { scamlord_plan_status: "rescheduled" } }) },
        }), d);

        expect(outcome.action).toBe("skipped");
        expect(d.startCollectionCall).not.toHaveBeenCalled();
    });

    it("skips when a call for the invoice is already active", async () => {
        const { db } = createSupabaseMock({ calls: { data: [{ id: "call_1" }], error: null } });
        const d = deps({ db });

        const outcome = await handleStripeEvent(asEvent({
            id: "evt_4",
            type: "invoice.payment_failed",
            data: { object: openInvoice() },
        }), d);

        expect(outcome).toEqual({ action: "skipped", reason: "a call for this invoice is already active" });
        expect(d.startCollectionCall).not.toHaveBeenCalled();
    });

    it("marks the call paid on invoice.paid", async () => {
        const { db, calls } = createSupabaseMock({ calls: { data: null, error: null } });

        const outcome = await handleStripeEvent(asEvent({
            id: "evt_5",
            type: "invoice.paid",
            data: { object: openInvoice({ status: "paid", amount_paid: 184000, amount_remaining: 0 }) },
        }), deps({ db }));

        expect(outcome).toEqual({ action: "payment_recorded", invoiceId: "in_overdue" });
        expect(calls).toContainEqual({ table: "calls", method: "eq", args: ["stripe_invoice_id", "in_overdue"] });
        expect(calls.find(call => call.method === "update")?.args[0]).toMatchObject({ status: "paid" });
    });

    it("does not record a payment when invoice.paid comes from plan credit notes", async () => {
        const outcome = await handleStripeEvent(asEvent({
            id: "evt_6",
            type: "invoice.paid",
            data: { object: openInvoice({ status: "paid", metadata: { scamlord_plan_status: "rescheduled" } }) },
        }), deps());

        expect(outcome.action).toBe("skipped");
    });

    it("marks the invoice paid out of band when a Checkout Session covers it", async () => {
        const retrieve = vi.fn(async () => openInvoice());
        const pay = vi.fn(async () => ({}));
        const d = deps({ stripe: asStripe({ invoices: { retrieve, pay } }) });

        const outcome = await handleStripeEvent(asEvent({
            id: "evt_7",
            type: "checkout.session.completed",
            data: {
                object: {
                    id: "cs_1",
                    payment_status: "paid",
                    amount_total: 184000,
                    metadata: { scamlord_invoice_id: "in_overdue" },
                },
            },
        }), d);

        expect(outcome).toEqual({ action: "payment_recorded", invoiceId: "in_overdue" });
        expect(pay).toHaveBeenCalledWith("in_overdue", { paid_out_of_band: true });
    });

    it("leaves the invoice open when the Checkout amount is short", async () => {
        const pay = vi.fn();
        const d = deps({ stripe: asStripe({ invoices: { retrieve: vi.fn(async () => openInvoice()), pay } }) });

        await handleStripeEvent(asEvent({
            id: "evt_8",
            type: "checkout.session.completed",
            data: {
                object: { id: "cs_2", payment_status: "paid", amount_total: 92000, metadata: { scamlord_invoice_id: "in_overdue" } },
            },
        }), d);

        expect(pay).not.toHaveBeenCalled();
    });

    it("ignores other event types", async () => {
        const outcome = await handleStripeEvent(asEvent({ id: "evt_9", type: "customer.created", data: { object: {} } }), deps());

        expect(outcome).toEqual({ action: "ignored", eventType: "customer.created" });
    });
});
