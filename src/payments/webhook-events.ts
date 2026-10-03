/**
 * @module payments/webhook-events
 *
 * Reacts to verified Stripe events (docs/SPEC.md → Call steps 1 and 9). A failed or overdue
 * invoice starts a collection call; a paid invoice or completed Checkout Session records the
 * payment. Dependencies are injected so the route stays thin and tests need no network.
 *
 * Depends on: stripe, @supabase/supabase-js, @/voice/context, ./collection-context, ./stripe
 * Used by: /api/stripe/webhook
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import type { CallContext } from "@/voice/context";
import { buildCollectionCallRequest } from "./collection-context";
import { PLAN_STATUS_RESCHEDULED, STRIPE_METADATA } from "./stripe";

/** Same contract as `startCollectionCall` in `@/voice/outbound-call`. */
export type TStartCollectionCall = (input: {
    toPhoneNumber: string;
    callContext: CallContext;
}) => Promise<{ roomName: string }>;

export type TStripeWebhookDeps = {
    stripe: Stripe;
    db: SupabaseClient | null;
    startCollectionCall: TStartCollectionCall;
    log?: Pick<Console, "info" | "warn" | "error">;
};

export type TStripeWebhookOutcome =
    | { action: "call_started"; invoiceId: string; roomName: string; source: "supabase" | "demo_fallback" }
    | { action: "payment_recorded"; invoiceId: string }
    | { action: "skipped"; reason: string }
    | { action: "ignored"; eventType: string };

/** Call rows in these states mean a call for the invoice is already running. */
const ACTIVE_CALL_STATUSES = ["in_progress", "waiting_on_person"];

async function hasActiveCall(db: SupabaseClient | null, invoiceId: string): Promise<boolean> {
    if (!db) {
        return false;
    }
    const { data, error } = await db
        .from("calls")
        .select("id")
        .eq("stripe_invoice_id", invoiceId)
        .in("status", ACTIVE_CALL_STATUSES)
        .limit(1);
    if (error) {
        return false;
    }
    return Array.isArray(data) && data.length > 0;
}

async function retrieveCustomer(stripe: Stripe, invoice: Stripe.Invoice): Promise<Stripe.Customer | null> {
    const customer = invoice.customer;
    if (customer == null) {
        return null;
    }
    if (typeof customer !== "string") {
        return customer.deleted ? null : customer;
    }
    if (invoice.customer_phone) {
        return null;
    }
    const fetched = await stripe.customers.retrieve(customer);
    return fetched.deleted ? null : fetched;
}

async function startCallForInvoice(
    invoice: Stripe.Invoice,
    deps: TStripeWebhookDeps,
): Promise<TStripeWebhookOutcome> {
    const log = deps.log ?? console;
    if (invoice.status !== "open") {
        return { action: "skipped", reason: `invoice is ${invoice.status ?? "unknown"}` };
    }
    if (invoice.metadata?.[STRIPE_METADATA.planStatus] === PLAN_STATUS_RESCHEDULED) {
        return { action: "skipped", reason: "invoice was moved into a payment plan" };
    }
    if (invoice.amount_remaining <= 0) {
        return { action: "skipped", reason: "nothing left to collect" };
    }
    if (await hasActiveCall(deps.db, invoice.id)) {
        return { action: "skipped", reason: "a call for this invoice is already active" };
    }

    const customer = await retrieveCustomer(deps.stripe, invoice);
    const request = await buildCollectionCallRequest({ invoice, customer, db: deps.db, log });
    const { roomName } = await deps.startCollectionCall({
        toPhoneNumber: request.toPhoneNumber,
        callContext: request.callContext,
    });
    log.info("[stripe] collection call started", {
        invoiceId: invoice.id,
        roomName,
        source: request.source,
        installment: invoice.metadata?.[STRIPE_METADATA.installment],
    });
    return { action: "call_started", invoiceId: invoice.id, roomName, source: request.source };
}

async function recordInvoicePaid(
    invoice: Stripe.Invoice,
    deps: TStripeWebhookDeps,
): Promise<TStripeWebhookOutcome> {
    const log = deps.log ?? console;
    if (invoice.metadata?.[STRIPE_METADATA.planStatus] === PLAN_STATUS_RESCHEDULED) {
        return { action: "skipped", reason: "invoice was closed by plan credit notes, not a payment" };
    }

    log.info("[stripe] invoice paid", {
        invoiceId: invoice.id,
        amountPaid: invoice.amount_paid,
        installment: invoice.metadata?.[STRIPE_METADATA.installment],
        originalInvoiceId: invoice.metadata?.[STRIPE_METADATA.originalInvoiceId],
    });
    if (deps.db) {
        const { error } = await deps.db
            .from("calls")
            .update({ status: "paid", updated_at: new Date().toISOString() })
            .eq("stripe_invoice_id", invoice.id);
        if (error) {
            log.warn("[stripe] could not mark call paid", { invoiceId: invoice.id, error: error.message });
        }
    }
    return { action: "payment_recorded", invoiceId: invoice.id };
}

async function recordCheckoutCompleted(
    session: Stripe.Checkout.Session,
    deps: TStripeWebhookDeps,
): Promise<TStripeWebhookOutcome> {
    const log = deps.log ?? console;
    const invoiceId = session.metadata?.[STRIPE_METADATA.invoiceId];
    if (session.payment_status !== "paid") {
        return { action: "skipped", reason: `checkout payment is ${session.payment_status}` };
    }
    if (!invoiceId) {
        log.info("[stripe] checkout completed without an invoice", { sessionId: session.id });
        return { action: "skipped", reason: "checkout session has no invoice" };
    }

    const invoice = await deps.stripe.invoices.retrieve(invoiceId);
    if (invoice.status === "open" && (session.amount_total ?? 0) >= invoice.amount_remaining) {
        await deps.stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
        log.info("[stripe] invoice paid through checkout", { invoiceId, sessionId: session.id });
    } else {
        log.info("[stripe] checkout payment did not settle the invoice", {
            invoiceId,
            sessionId: session.id,
            amountTotal: session.amount_total,
            amountRemaining: invoice.amount_remaining,
            status: invoice.status,
        });
    }
    return { action: "payment_recorded", invoiceId };
}

/**
 * Dispatches one verified Stripe event.
 *
 * @param event - Event from `stripe.webhooks.constructEventAsync`
 * @param deps - Stripe client, optional Supabase client, call starter, logger
 */
export async function handleStripeEvent(
    event: Stripe.Event,
    deps: TStripeWebhookDeps,
): Promise<TStripeWebhookOutcome> {
    switch (event.type) {
        case "invoice.payment_failed":
        case "invoice.overdue":
            return startCallForInvoice(event.data.object, deps);
        case "invoice.paid":
            return recordInvoicePaid(event.data.object, deps);
        case "checkout.session.completed":
            return recordCheckoutCompleted(event.data.object, deps);
        default:
            return { action: "ignored", eventType: event.type };
    }
}
