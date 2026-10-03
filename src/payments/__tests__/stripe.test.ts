// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import {
    createPaymentLink,
    getInvoicePaymentStatus,
    PaymentPlanMismatchError,
    writePaymentPlan,
} from "../stripe";

function asStripe(mock: unknown): Stripe {
    return mock as Stripe;
}

function invoice(overrides: Record<string, unknown> = {}) {
    return {
        id: "in_overdue",
        number: "INV-0001",
        customer: "cus_jordan",
        status: "open",
        currency: "usd",
        amount_due: 184000,
        amount_paid: 0,
        amount_remaining: 184000,
        hosted_invoice_url: "https://invoice.stripe.com/i/in_overdue",
        metadata: {},
        due_date: 1790553600,
        ...overrides,
    };
}

function planMock(original = invoice()) {
    let created = 0;
    const invoicesCreate = vi.fn(async () => ({ id: `in_inst_${++created}` }));
    const finalizeInvoice = vi.fn(async (id: string) => ({
        id,
        hosted_invoice_url: `https://invoice.stripe.com/i/${id}`,
    }));
    const update = vi.fn(async () => ({}));
    const invoiceItemsCreate = vi.fn(async () => ({ id: "ii_1" }));
    let notes = 0;
    const creditNotesCreate = vi.fn(async () => ({ id: `cn_${++notes}` }));
    const stripe = {
        invoices: {
            retrieve: vi.fn(async () => original),
            create: invoicesCreate,
            finalizeInvoice,
            update,
        },
        invoiceItems: { create: invoiceItemsCreate },
        creditNotes: { create: creditNotesCreate, list: vi.fn(async () => ({ data: [] })) },
    };
    return { stripe, invoicesCreate, finalizeInvoice, update, invoiceItemsCreate, creditNotesCreate };
}

describe("createPaymentLink", () => {
    it("returns the hosted invoice page when the invoice is open for exactly that amount", async () => {
        const retrieve = vi.fn(async () => invoice());
        const sessionsCreate = vi.fn();
        const stripe = asStripe({ invoices: { retrieve }, checkout: { sessions: { create: sessionsCreate } } });

        const link = await createPaymentLink({
            stripe,
            invoiceId: "in_overdue",
            amountCents: 184000,
            currency: "usd",
            description: "Rent",
        });

        expect(link).toEqual({
            url: "https://invoice.stripe.com/i/in_overdue",
            source: "hosted_invoice",
            objectId: "in_overdue",
        });
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("creates a destination-charge Checkout Session tied to the invoice for a partial amount", async () => {
        const retrieve = vi.fn(async () => invoice());
        const sessionsCreate = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }));
        const stripe = asStripe({ invoices: { retrieve }, checkout: { sessions: { create: sessionsCreate } } });

        const link = await createPaymentLink({
            stripe,
            invoiceId: "in_overdue",
            amountCents: 92000,
            currency: "usd",
            description: "Maple Court Unit 2B rent",
            connectedAccountId: "acct_landlord",
            metadata: { call: "room_1" },
            successUrl: "https://example.com/done",
        });

        expect(link).toEqual({ url: "https://checkout.stripe.com/c/cs_1", source: "checkout_session", objectId: "cs_1" });
        expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
            mode: "payment",
            line_items: [{
                quantity: 1,
                price_data: { currency: "usd", unit_amount: 92000, product_data: { name: "Maple Court Unit 2B rent" } },
            }],
            payment_intent_data: expect.objectContaining({
                transfer_data: { destination: "acct_landlord" },
                metadata: { call: "room_1", scamlord_invoice_id: "in_overdue" },
            }),
            metadata: { call: "room_1", scamlord_invoice_id: "in_overdue" },
            success_url: "https://example.com/done",
        }));
    });

    it("uses Checkout when a destination is requested but the invoice was not created for it", async () => {
        const retrieve = vi.fn(async () => invoice());
        const sessionsCreate = vi.fn(async () => ({ id: "cs_2", url: "https://checkout.stripe.com/c/cs_2" }));
        const stripe = asStripe({ invoices: { retrieve }, checkout: { sessions: { create: sessionsCreate } } });

        const link = await createPaymentLink({
            stripe,
            invoiceId: "in_overdue",
            amountCents: 184000,
            currency: "usd",
            description: "Rent",
            connectedAccountId: "acct_landlord",
        });

        expect(link.source).toBe("checkout_session");
    });

    it("rejects non-integer amounts", async () => {
        await expect(createPaymentLink({
            stripe: asStripe({}),
            amountCents: 10.5,
            currency: "usd",
            description: "Rent",
        })).rejects.toThrow("positive integer");
    });
});

describe("writePaymentPlan", () => {
    const now = new Date("2026-10-03T19:00:00Z");

    it("creates one finalized invoice per installment and credits the overdue invoice into the plan", async () => {
        const m = planMock(invoice({ amount_remaining: 191500 }));

        const result = await writePaymentPlan({
            stripe: asStripe(m.stripe),
            invoiceId: "in_overdue",
            customerId: "cus_jordan",
            plan: {
                installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-17", amount: 920 }],
                feeWaiver: 75,
            },
            connectedAccountId: "acct_landlord",
            now,
        });

        expect(result).toEqual({
            originalInvoiceId: "in_overdue",
            installments: [
                { invoiceId: "in_inst_1", dueDate: "2026-10-03", amountCents: 92000, hostedInvoiceUrl: "https://invoice.stripe.com/i/in_inst_1" },
                { invoiceId: "in_inst_2", dueDate: "2026-10-17", amountCents: 92000, hostedInvoiceUrl: "https://invoice.stripe.com/i/in_inst_2" },
            ],
            creditNoteIds: ["cn_1", "cn_2"],
            feeWaiverCents: 7500,
            alreadyWritten: false,
        });

        expect(m.invoicesCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
            customer: "cus_jordan",
            collection_method: "send_invoice",
            due_date: Date.UTC(2026, 9, 3, 23, 59, 59) / 1000,
            pending_invoice_items_behavior: "exclude",
            transfer_data: { destination: "acct_landlord" },
            metadata: expect.objectContaining({
                scamlord_original_invoice_id: "in_overdue",
                scamlord_installment: "1/2",
                scamlord_destination: "acct_landlord",
            }),
        }), { idempotencyKey: expect.stringMatching(/^scamlord-plan-in_overdue-[0-9a-f]{16}-0-invoice$/) });
        expect(m.invoiceItemsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ invoice: "in_inst_2", amount: 92000, currency: "usd" }),
            expect.anything(),
        );
        expect(m.finalizeInvoice).toHaveBeenCalledTimes(2);
        expect(m.update).toHaveBeenCalledWith("in_overdue", {
            metadata: {
                scamlord_plan_status: "rescheduled",
                scamlord_installment_invoice_ids: "in_inst_1,in_inst_2",
                scamlord_fee_waiver_cents: "7500",
            },
        });
        expect(m.creditNotesCreate).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ invoice: "in_overdue", amount: 7500 }),
            expect.anything(),
        );
        expect(m.creditNotesCreate).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ invoice: "in_overdue", amount: 184000 }),
            expect.anything(),
        );
    });

    it("pushes a due date that already passed in UTC an hour into the future", async () => {
        const m = planMock();
        const late = new Date("2026-10-04T01:00:00Z");

        await writePaymentPlan({
            stripe: asStripe(m.stripe),
            invoiceId: "in_overdue",
            customerId: "cus_jordan",
            plan: { installments: [{ date: "2026-10-03", amount: 1840 }] },
            now: late,
        });

        expect(m.invoicesCreate).toHaveBeenCalledWith(
            expect.objectContaining({ due_date: late.getTime() / 1000 + 3600 }),
            expect.anything(),
        );
        expect(m.invoicesCreate.mock.calls[0]).not.toHaveProperty("0.transfer_data");
        expect(m.creditNotesCreate).toHaveBeenCalledTimes(1);
    });

    it("rejects a plan that does not add up to the open balance", async () => {
        const m = planMock();

        await expect(writePaymentPlan({
            stripe: asStripe(m.stripe),
            invoiceId: "in_overdue",
            customerId: "cus_jordan",
            plan: { installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-17", amount: 920 }], feeWaiver: 75 },
            now,
        })).rejects.toBeInstanceOf(PaymentPlanMismatchError);
        expect(m.invoicesCreate).not.toHaveBeenCalled();
    });

    it("rejects an invoice owned by another customer", async () => {
        const m = planMock();

        await expect(writePaymentPlan({
            stripe: asStripe(m.stripe),
            invoiceId: "in_overdue",
            customerId: "cus_someone_else",
            plan: { installments: [{ date: "2026-10-03", amount: 1840 }] },
            now,
        })).rejects.toThrow("does not belong");
    });

    it("returns the plan already written when the invoice was rescheduled", async () => {
        const original = invoice({
            status: "paid",
            metadata: {
                scamlord_plan_status: "rescheduled",
                scamlord_installment_invoice_ids: "in_inst_1",
                scamlord_fee_waiver_cents: "0",
            },
        });
        const retrieve = vi.fn(async (id: string) => (id === "in_overdue"
            ? original
            : { id, due_date: Date.UTC(2026, 9, 3, 23, 59, 59) / 1000, amount_due: 184000, hosted_invoice_url: "https://h" }));
        const create = vi.fn();
        const stripe = asStripe({
            invoices: { retrieve, create },
            creditNotes: { list: vi.fn(async () => ({ data: [{ id: "cn_9" }] })) },
        });

        const result = await writePaymentPlan({
            stripe,
            invoiceId: "in_overdue",
            customerId: "cus_jordan",
            plan: { installments: [{ date: "2026-10-03", amount: 1840 }] },
            now,
        });

        expect(result).toEqual({
            originalInvoiceId: "in_overdue",
            installments: [{ invoiceId: "in_inst_1", dueDate: "2026-10-03", amountCents: 184000, hostedInvoiceUrl: "https://h" }],
            creditNoteIds: ["cn_9"],
            feeWaiverCents: 0,
            alreadyWritten: true,
        });
        expect(create).not.toHaveBeenCalled();
    });
});

describe("getInvoicePaymentStatus", () => {
    it("reports a paid invoice", async () => {
        const stripe = asStripe({
            invoices: { retrieve: vi.fn(async () => invoice({ status: "paid", amount_paid: 184000, amount_remaining: 0 })) },
        });

        const status = await getInvoicePaymentStatus({ stripe, invoiceId: "in_overdue" });

        expect(status).toMatchObject({ status: "paid", paid: true, rescheduled: false, amountPaidCents: 184000 });
    });

    it("does not treat a credited-into-plan invoice as paid", async () => {
        const stripe = asStripe({
            invoices: {
                retrieve: vi.fn(async () => invoice({
                    status: "paid",
                    amount_remaining: 0,
                    metadata: { scamlord_plan_status: "rescheduled", scamlord_installment_invoice_ids: "in_a,in_b" },
                })),
            },
        });

        const status = await getInvoicePaymentStatus({ stripe, invoiceId: "in_overdue" });

        expect(status).toMatchObject({ paid: false, rescheduled: true, installmentInvoiceIds: ["in_a", "in_b"] });
    });
});
