// @vitest-environment node
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "whsec_test_route";
const stripe = new Stripe("sk_test_route_dummy");
const afterCallbacks: Array<() => Promise<void>> = [];

const { startCollectionCall } = vi.hoisted(() => ({
    startCollectionCall: vi.fn(async () => ({ roomName: "collection-room-1" })),
}));

vi.mock("next/server", async importOriginal => ({
    ...(await importOriginal<typeof import("next/server")>()),
    after: (callback: () => Promise<void>) => {
        afterCallbacks.push(callback);
    },
}));
vi.mock("@/voice/outbound-call", () => ({ startCollectionCall }));
vi.mock("@/payments/stripe", async importOriginal => ({
    ...(await importOriginal<typeof import("@/payments/stripe")>()),
    getStripeClient: () => stripe,
}));
vi.mock("@/payments/collection-context", async importOriginal => ({
    ...(await importOriginal<typeof import("@/payments/collection-context")>()),
    getCollectionDb: () => null,
}));

import { POST } from "../route";

async function signedRequest(event: Record<string, unknown>, secret = SECRET): Promise<Request> {
    const payload = JSON.stringify(event);
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    return new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
    });
}

function failedInvoiceEvent(id: string) {
    return {
        id,
        object: "event",
        type: "invoice.payment_failed",
        data: {
            object: {
                id: "in_overdue",
                object: "invoice",
                status: "open",
                customer: "cus_jordan",
                customer_name: "Jordan Lee",
                customer_phone: "+15555550102",
                customer_email: "jordan@example.com",
                amount_remaining: 184000,
                due_date: Date.UTC(2026, 8, 28) / 1000,
                created: Date.UTC(2026, 8, 1) / 1000,
                metadata: {},
            },
        },
    };
}

async function runAfterCallbacks() {
    while (afterCallbacks.length > 0) {
        await afterCallbacks.shift()?.();
    }
}

describe("POST /api/stripe/webhook", () => {
    beforeEach(() => {
        vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(stripe.invoices, "list").mockImplementation(() => Promise.reject(new Error("offline")) as never);
        startCollectionCall.mockClear();
        afterCallbacks.length = 0;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it("acknowledges a signed invoice.payment_failed and starts the call after responding", async () => {
        const response = await POST(await signedRequest(failedInvoiceEvent("evt_route_1")));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ received: true });
        expect(startCollectionCall).not.toHaveBeenCalled();

        await runAfterCallbacks();

        expect(startCollectionCall).toHaveBeenCalledWith({
            toPhoneNumber: "+15555550102",
            callContext: expect.objectContaining({ stripeInvoiceId: "in_overdue", openBalance: 1840 }),
        });
    });

    it("acknowledges a repeated event id without handling it again", async () => {
        await POST(await signedRequest(failedInvoiceEvent("evt_route_2")));
        await runAfterCallbacks();

        const repeat = await POST(await signedRequest(failedInvoiceEvent("evt_route_2")));
        await runAfterCallbacks();

        expect(await repeat.json()).toEqual({ received: true, duplicate: true });
        expect(startCollectionCall).toHaveBeenCalledTimes(1);
    });

    it("rejects a bad signature", async () => {
        const response = await POST(await signedRequest(failedInvoiceEvent("evt_route_3"), "whsec_wrong"));

        expect(response.status).toBe(400);
        expect(afterCallbacks).toHaveLength(0);
    });

    it("rejects a missing signature", async () => {
        const response = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }));

        expect(response.status).toBe(400);
    });

    it("returns 500 when the webhook secret is not configured", async () => {
        vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

        const response = await POST(await signedRequest(failedInvoiceEvent("evt_route_4")));

        expect(response.status).toBe(500);
    });
});
