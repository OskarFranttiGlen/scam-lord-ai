/**
 * @module voice/payment-watch
 *
 * Tenants often pay while still on the line once accept_plan has texted the link. This
 * watches Stripe for that payment and announces it the moment it lands, once, without
 * interrupting the agent: it polls the same invoice confirm_payment would check, and when
 * it reads paid it marks the state and generates one reply once the agent is back to
 * listening. Never throws; stops on timeout, call end, a Stripe error, an
 * already-confirmed payment, or the returned stop handle (the worker calls it on room close).
 *
 * Depends on: @livekit/agents, @/payments/stripe, ./context, ./instructions
 * Used by: ./worker.ts
 */

import { voice } from "@livekit/agents";
import type Stripe from "stripe";

import { getInvoicePaymentStatus } from "@/payments/stripe";
import type { CallContext, CallState } from "./context";
import { spokenDollars } from "./instructions";

/** How often Stripe is polled once a plan is accepted. */
export const PAYMENT_POLL_INTERVAL_MS = 3000;

/** How long the watcher keeps looking for the payment before giving up. */
export const PAYMENT_WATCH_TIMEOUT_MS = 10 * 60_000;

/** The slice of `voice.AgentSession` this needs. */
export type TPaymentWatchSession = Pick<voice.AgentSession, "on" | "generateReply" | "agentState">;

export type TPaymentWatchInput = {
    state: CallState;
    /** Stripe client to poll; injectable for tests. */
    stripe: Stripe;
    session: TPaymentWatchSession;
    context: CallContext;
    /** Poll interval; defaults to {@link PAYMENT_POLL_INTERVAL_MS}. */
    intervalMs?: number;
    /** Give up after this long; defaults to {@link PAYMENT_WATCH_TIMEOUT_MS}. */
    timeoutMs?: number;
    /** Clock override for tests. */
    now?: () => number;
    log?: Pick<Console, "info" | "warn">;
};

/**
 * Announces the tenant's payment on the live call the moment it lands in Stripe. Once
 * `state.acceptedPlan` has a payable first installment, polls `state.paymentInvoiceId`
 * (the Checkout fallback: the call's invoice, exactly what confirm_payment checks) every
 * `intervalMs`; when it reads paid, sets `state.paymentConfirmed`, waits for the agent to
 * stop speaking, and calls `generateReply` once with the amount in words. Fires once.
 *
 * @param input - State, Stripe client, session, call context, optional timing overrides
 * @returns Stop handle the caller invokes on room close
 */
export function watchForPayment(input: TPaymentWatchInput): () => void {
    const { state, stripe, session, context } = input;
    const intervalMs = input.intervalMs ?? PAYMENT_POLL_INTERVAL_MS;
    const now = input.now ?? Date.now;
    const log = input.log ?? console;
    const deadline = now() + (input.timeoutMs ?? PAYMENT_WATCH_TIMEOUT_MS);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let agentBusy = session.agentState === "speaking" || session.agentState === "thinking";
    let idleWaiters: Array<() => void> = [];

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev: voice.AgentStateChangedEvent) => {
        agentBusy = ev.newState === "speaking" || ev.newState === "thinking";
        if (ev.newState !== "listening") {
            return;
        }
        const waiters = idleWaiters;
        idleWaiters = [];
        waiters.forEach(resolve => resolve());
    });

    const stop = () => {
        stopped = true;
        clearTimeout(timer);
        const waiters = idleWaiters;
        idleWaiters = [];
        waiters.forEach(resolve => resolve());
    };

    const sleep = (ms: number) => new Promise<void>(resolve => {
        timer = setTimeout(resolve, ms);
    });

    /** Resolves once the agent is back to listening; false when the watch or the call ended first. */
    const waitForIdle = async (): Promise<boolean> => {
        if (!agentBusy) {
            return true;
        }
        await new Promise<void>(resolve => idleWaiters.push(resolve));
        return !stopped && !state.callEnded;
    };

    const announce = async (amount: number): Promise<void> => {
        const words = spokenDollars(amount);
        await session.generateReply({
            instructions: `The tenant's payment of ${words} was just received. Say exactly "${words} received." `
                + "then follow the DUE DATE CHANGE rule if it applies; otherwise thank them briefly and "
                + "call end_call.",
        });
    };

    const run = async (): Promise<void> => {
        while (!stopped) {
            await sleep(intervalMs);
            if (stopped || state.callEnded || state.paymentConfirmed) {
                return;
            }
            const amount = state.acceptedPlan?.installments[0]?.amount;
            if (amount == null) {
                if (now() >= deadline) {
                    return;
                }
                continue;
            }
            const invoiceId = state.paymentInvoiceId ?? context.stripeInvoiceId;
            let paid = false;
            try {
                paid = (await getInvoicePaymentStatus({ stripe, invoiceId })).paid;
            } catch (error) {
                log.warn("[voice/payment-watch] could not read Stripe; stopping", {
                    invoiceId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return;
            }
            if (stopped || state.callEnded || state.paymentConfirmed) {
                return;
            }
            if (paid) {
                state.paymentConfirmed = true;
                log.info("[voice/payment-watch] payment received; announcing", { invoiceId });
                if (await waitForIdle()) {
                    try {
                        await announce(amount);
                    } catch (error) {
                        log.warn("[voice/payment-watch] announcement failed", {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                return;
            }
            if (now() >= deadline) {
                log.info("[voice/payment-watch] timed out waiting for the payment", { invoiceId });
                return;
            }
        }
    };

    // Contain every failure: the watcher must never take the call down with it.
    run().catch(error => {
        stopped = true;
        clearTimeout(timer);
        log.warn("[voice/payment-watch] stopped after an error", {
            error: error instanceof Error ? error.message : String(error),
        });
    });

    return stop;
}