/**
 * @module api/stripe/webhook
 *
 * Stripe webhook endpoint. Verifies the signature with `STRIPE_WEBHOOK_SECRET`, acknowledges
 * at once, and handles the event after the response so Stripe never waits on call setup.
 * Duplicate deliveries of the same event id are acknowledged without re-running.
 *
 * Local: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
 *
 * Depends on: next/server, @/payments/stripe, @/payments/collection-context,
 * @/payments/webhook-events, @/voice/outbound-call
 * Used by: Stripe (invoice.payment_failed, invoice.overdue, invoice.paid, checkout.session.completed)
 */

import { after, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getCollectionDb } from "@/payments/collection-context";
import { getStripeClient } from "@/payments/stripe";
import { handleStripeEvent } from "@/payments/webhook-events";
import { startCollectionCall } from "@/voice/outbound-call";

export const runtime = "nodejs";

const MAX_REMEMBERED_EVENTS = 1000;
const seenEventIds = new Set<string>();

/**
 * Records an event id; returns false when it was already seen by this instance.
 *
 * @param eventId - Stripe event id
 */
function markEventSeen(eventId: string): boolean {
    if (seenEventIds.has(eventId)) {
        return false;
    }
    seenEventIds.add(eventId);
    if (seenEventIds.size > MAX_REMEMBERED_EVENTS) {
        const oldest = seenEventIds.values().next().value;
        if (oldest) {
            seenEventIds.delete(oldest);
        }
    }
    return true;
}

/**
 * Receives a Stripe event.
 *
 * @param request - Raw webhook request with the `stripe-signature` header
 */
export async function POST(request: Request) {
    const stripe = getStripeClient();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) {
        console.error("[stripe] webhook missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
        return NextResponse.json({ error: "stripe_not_configured" }, { status: 500 });
    }

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
        return NextResponse.json({ error: "missing_signature" }, { status: 400 });
    }

    const payload = await request.text();
    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
    } catch {
        return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }

    if (!markEventSeen(event.id)) {
        return NextResponse.json({ received: true, duplicate: true });
    }

    after(async () => {
        try {
            const outcome = await handleStripeEvent(event, {
                stripe,
                db: getCollectionDb(),
                startCollectionCall,
            });
            console.info("[stripe] webhook handled", { eventId: event.id, type: event.type, outcome });
        } catch (error) {
            console.error("[stripe] webhook handler failed", { eventId: event.id, type: event.type, error });
        }
    });

    return NextResponse.json({ received: true });
}
