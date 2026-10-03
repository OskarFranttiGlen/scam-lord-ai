import { EventEmitter } from "node:events";

import { voice } from "@livekit/agents";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialCallState, type CallContext, type CallState, type TAcceptedPlan } from "../context";
import { watchForPayment, type TPaymentWatchSession } from "../payment-watch";

const E = voice.AgentSessionEventTypes;

function asSession(value: unknown): TPaymentWatchSession {
    return value as TPaymentWatchSession;
}

function asStripeClient(value: unknown): Stripe {
    return value as Stripe;
}

/** Minimal invoice status shape `getInvoicePaymentStatus` reads. */
function fakeStripe() {
    const fake = {
        paid: false,
        retrieve: vi.fn(async (invoiceId: string) => ({
            id: invoiceId,
            status: fake.paid ? "paid" : "open",
            metadata: {},
            amount_due: 1200_00,
            amount_paid: fake.paid ? 1200_00 : 0,
            amount_remaining: fake.paid ? 0 : 1200_00,
            currency: "usd",
            hosted_invoice_url: "https://pay.example/inv",
        })),
    };
    return {
        retrieve: fake.retrieve,
        setPaid: (paid: boolean) => {
            fake.paid = paid;
        },
        stripe: asStripeClient({ invoices: { retrieve: fake.retrieve } }),
    };
}

function failingStripe() {
    const retrieve = vi.fn(async () => {
        throw new Error("Stripe is down");
    });
    return { retrieve, stripe: asStripeClient({ invoices: { retrieve } }) };
}

function fakeSession(initialState = "listening") {
    const emitter = new EventEmitter();
    const generateReply = vi.fn();
    let agentState = initialState;
    return {
        generateReply,
        agent: (newState: string) => {
            agentState = newState;
            emitter.emit(E.AgentStateChanged, { newState });
        },
        session: asSession({
            on: emitter.on.bind(emitter),
            generateReply,
            get agentState() {
                return agentState;
            },
        }),
    };
}

function fakeContext(): CallContext {
    return {
        tenantName: "Dana Demo",
        propertyName: "Demo Properties",
        unitLabel: "Unit 4B",
        phone: "+15550001234",
        email: "dana@example.org",
        openBalance: 1200,
        invoiceDueDate: "2026-10-05",
        policy: { maxInstallments: 3, graceDays: 5, feeWaiverCap: 50 },
        perks: [],
        stripeInvoiceId: "in_demo",
    };
}

function acceptedPlan(amount = 1200): TAcceptedPlan {
    return { installments: [{ date: "2026-10-03", amount }] };
}

const quietLog = { info: vi.fn(), warn: vi.fn() };

function startWatch(
    state: CallState,
    session: TPaymentWatchSession,
    stripe: Stripe,
    { intervalMs = 1000, timeoutMs = 10_000 } = {},
) {
    return watchForPayment({
        state,
        stripe,
        session,
        context: fakeContext(),
        intervalMs,
        timeoutMs,
        log: quietLog,
    });
}

const EXPECTED_INSTRUCTIONS = "The tenant's payment of twelve hundred dollars was just received. "
    + "Say exactly \"twelve hundred dollars received.\" then follow the DUE DATE CHANGE rule if it applies; "
    + "otherwise thank them briefly and call end_call.";

describe("watchForPayment", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        quietLog.info.mockClear();
        quietLog.warn.mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not poll Stripe or reply while no plan is accepted", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = fakeStripe();
        const stop = startWatch(createInitialCallState(), s.session, stripe);

        await vi.advanceTimersByTimeAsync(3000);

        expect(retrieve).not.toHaveBeenCalled();
        expect(s.generateReply).not.toHaveBeenCalled();
        stop();
    });

    it("announces once, with the amount in words, once the first installment is paid", async () => {
        const s = fakeSession();
        const { retrieve, setPaid, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan(1200);
        state.paymentInvoiceId = "in_first";
        const stop = startWatch(state, s.session, stripe);

        await vi.advanceTimersByTimeAsync(1000);
        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(retrieve).toHaveBeenCalledWith("in_first");

        setPaid(true);
        await vi.advanceTimersByTimeAsync(1000);

        expect(state.paymentConfirmed).toBe(true);
        expect(s.generateReply).toHaveBeenCalledTimes(1);
        expect(s.generateReply).toHaveBeenCalledWith({ instructions: EXPECTED_INSTRUCTIONS });

        await vi.advanceTimersByTimeAsync(3000);
        expect(s.generateReply).toHaveBeenCalledTimes(1);
        expect(retrieve).toHaveBeenCalledTimes(2);
        stop();
    });

    it("checks the call's invoice when the link was a Checkout session", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        const stop = startWatch(state, s.session, stripe);

        await vi.advanceTimersByTimeAsync(1000);

        expect(retrieve).toHaveBeenCalledWith("in_demo");
        stop();
    });

    it("waits until the agent stops speaking before announcing", async () => {
        const s = fakeSession("speaking");
        const { setPaid, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        const stop = startWatch(state, s.session, stripe);

        setPaid(true);
        await vi.advanceTimersByTimeAsync(1000);

        expect(state.paymentConfirmed).toBe(true);
        expect(s.generateReply).not.toHaveBeenCalled();

        s.agent("listening");
        await vi.advanceTimersByTimeAsync(0);

        expect(s.generateReply).toHaveBeenCalledTimes(1);
        expect(s.generateReply).toHaveBeenCalledWith({ instructions: EXPECTED_INSTRUCTIONS });
        stop();
    });

    it("stays quiet when confirm_payment already confirmed the payment", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        state.paymentConfirmed = true;
        const stop = startWatch(state, s.session, stripe);

        await vi.advanceTimersByTimeAsync(3000);

        expect(retrieve).not.toHaveBeenCalled();
        expect(s.generateReply).not.toHaveBeenCalled();
        stop();
    });

    it("stops polling once the timeout passes", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        const stop = startWatch(state, s.session, stripe, { intervalMs: 1000, timeoutMs: 3000 });

        await vi.advanceTimersByTimeAsync(3000);
        expect(retrieve).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(5000);
        expect(retrieve).toHaveBeenCalledTimes(3);
        expect(s.generateReply).not.toHaveBeenCalled();
        stop();
    });

    it("stops polling without replying once the call ends", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = fakeStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        const stop = startWatch(state, s.session, stripe);

        await vi.advanceTimersByTimeAsync(1000);
        expect(retrieve).toHaveBeenCalledTimes(1);

        state.callEnded = true;
        await vi.advanceTimersByTimeAsync(2000);

        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(s.generateReply).not.toHaveBeenCalled();
        stop();
    });

    it("logs and stops when Stripe errors, without throwing", async () => {
        const s = fakeSession();
        const { retrieve, stripe } = failingStripe();
        const state = createInitialCallState();
        state.acceptedPlan = acceptedPlan();
        const stop = startWatch(state, s.session, stripe);

        await vi.advanceTimersByTimeAsync(1000);
        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(quietLog.warn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(2000);
        expect(retrieve).toHaveBeenCalledTimes(1);
        expect(s.generateReply).not.toHaveBeenCalled();
        stop();
    });
});