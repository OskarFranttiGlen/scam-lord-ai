/**
 * @vitest-environment node
 */
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendPaymentLinkMessages } from "@/messaging/send-payment-link";
import { createPaymentLink, getStripeClient, writePaymentPlan } from "@/payments/stripe";
import { getDemoCallContext } from "@/voice/demo-context";
import { fulfilAcceptedPlan } from "@/voice/fulfil-plan";

vi.mock("@/payments/stripe", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/payments/stripe")>()),
    getStripeClient: vi.fn(),
    writePaymentPlan: vi.fn(),
    createPaymentLink: vi.fn(),
}));

vi.mock("@/messaging/send-payment-link", () => ({
    sendPaymentLinkMessages: vi.fn(async () => ({
        sms: { status: "sent", id: "SM1" },
        email: { status: "sent", id: "em_1" },
        anySent: true,
    })),
}));

const PLAN = {
    installments: [
        { date: "2026-10-03", amount: 920 },
        { date: "2026-10-09", amount: 920 },
    ],
};

const quietLog = { info: vi.fn(), warn: vi.fn() };

/**
 * Fake Stripe client whose invoice lookup resolves or rejects.
 *
 * @param invoice - Invoice returned by `invoices.retrieve`, or an Error to throw
 */
function fakeStripe(invoice: { id: string; customer: string } | Error) {
    const retrieve = vi.fn(async () => {
        if (invoice instanceof Error) {
            throw invoice;
        }
        return invoice;
    });
    vi.mocked(getStripeClient).mockReturnValue(asStripe({ invoices: { retrieve } }));
}

/**
 * Casts a partial fake to the Stripe client type.
 *
 * @param value - Fake client exposing only what the module calls
 */
function asStripe(value: unknown): Stripe {
    return value as Stripe;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("fulfilAcceptedPlan", () => {
    it("writes the plan into Stripe and sends the first installment's invoice link", async () => {
        const ctx = getDemoCallContext();
        fakeStripe({ id: ctx.stripeInvoiceId, customer: "cus_1" });
        vi.mocked(writePaymentPlan).mockResolvedValue({
            originalInvoiceId: ctx.stripeInvoiceId,
            installments: [
                { invoiceId: "in_a", dueDate: "2026-10-03", amountCents: 92000, hostedInvoiceUrl: "https://pay/a" },
                { invoiceId: "in_b", dueDate: "2026-10-09", amountCents: 92000, hostedInvoiceUrl: "https://pay/b" },
            ],
            creditNoteIds: [],
            feeWaiverCents: 0,
            alreadyWritten: false,
        });

        const result = await fulfilAcceptedPlan(ctx, PLAN, quietLog);

        expect(writePaymentPlan).toHaveBeenCalledWith(expect.objectContaining({
            invoiceId: ctx.stripeInvoiceId,
            customerId: "cus_1",
            plan: PLAN,
        }));
        expect(result).toMatchObject({ url: "https://pay/a", source: "plan_invoice", payInvoiceId: "in_a" });
        expect(sendPaymentLinkMessages).toHaveBeenCalledWith(expect.objectContaining({
            url: "https://pay/a",
            amountDollars: 920,
        }));
    });

    it("falls back to a Checkout link for the first installment when the invoice is not in Stripe", async () => {
        fakeStripe(new Error("No such invoice"));
        vi.mocked(createPaymentLink).mockResolvedValue({
            url: "https://checkout/cs_1",
            source: "checkout_session",
            objectId: "cs_1",
        });

        const result = await fulfilAcceptedPlan(getDemoCallContext(), PLAN, quietLog);

        expect(writePaymentPlan).not.toHaveBeenCalled();
        expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 92000 }));
        expect(result).toMatchObject({ url: "https://checkout/cs_1", source: "checkout_session" });
        expect(sendPaymentLinkMessages).toHaveBeenCalledWith(expect.objectContaining({ url: "https://checkout/cs_1" }));
    });

    it("sends nothing when Stripe is not configured", async () => {
        vi.mocked(getStripeClient).mockReturnValue(null);

        const result = await fulfilAcceptedPlan(getDemoCallContext(), PLAN, quietLog);

        expect(result.url).toBeNull();
        expect(sendPaymentLinkMessages).not.toHaveBeenCalled();
    });

    it("messages only the requested channels, read once the link exists", async () => {
        fakeStripe(new Error("No such invoice"));
        vi.mocked(createPaymentLink).mockResolvedValue({ url: "https://c", source: "checkout_session", objectId: "cs" });
        const delivery: { channels: Array<"sms" | "email"> } = { channels: ["email"] };

        const pending = fulfilAcceptedPlan(getDemoCallContext(), PLAN, quietLog, delivery);
        delivery.channels = ["sms", "email"];
        await pending;

        expect(sendPaymentLinkMessages).toHaveBeenCalledWith(expect.objectContaining({ channels: ["sms", "email"] }));
    });

    it("messages both channels by default", async () => {
        fakeStripe(new Error("No such invoice"));
        vi.mocked(createPaymentLink).mockResolvedValue({ url: "https://c", source: "checkout_session", objectId: "cs" });

        await fulfilAcceptedPlan(getDemoCallContext(), PLAN, quietLog);

        expect(sendPaymentLinkMessages).toHaveBeenCalledWith(expect.objectContaining({ channels: ["sms", "email"] }));
    });

    it("sends to the demo recipients when they are configured", async () => {
        vi.stubEnv("DEMO_TENANT_PHONE", "+15550001111");
        vi.stubEnv("DEMO_TENANT_EMAIL", "me@example.org");
        fakeStripe(new Error("No such invoice"));
        vi.mocked(createPaymentLink).mockResolvedValue({ url: "https://c", source: "checkout_session", objectId: "cs" });

        await fulfilAcceptedPlan(getDemoCallContext(), PLAN, quietLog);

        expect(sendPaymentLinkMessages).toHaveBeenCalledWith(expect.objectContaining({
            phone: "+15550001111",
            email: "me@example.org",
        }));
    });
});
