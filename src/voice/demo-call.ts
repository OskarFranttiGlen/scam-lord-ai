/**
 * @module voice/demo-call
 *
 * Places the demo collection call (John Reyes, Sunset Properties) to any number. With a Stripe
 * test key it first makes sure the demo invoice is still open (the previous one is closed
 * whenever a plan was written), so the agent never falls back to a Checkout link.
 *
 * Depends on: @/payments/demo-invoice, @/payments/stripe, @/voice/demo-context, @/voice/outbound-call
 * Used by: scripts/call-tenant.ts, api/calls/demo
 */

import { ensureOpenDemoInvoice } from "@/payments/demo-invoice";
import { getStripeClient } from "@/payments/stripe";
import type { CallContext } from "./context";
import { getDemoCallContext } from "./demo-context";
import { startCollectionCall } from "./outbound-call";

const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * @param phone - Candidate number, already trimmed
 */
export function isE164(phone: string): boolean {
    return E164_RE.test(phone);
}

/**
 * Swaps in a payable demo invoice when Stripe test mode is configured. Never blocks the dial:
 * a Stripe failure logs a warning and the stored context goes out unchanged.
 *
 * @param callContext - Demo tenancy the call is about
 */
async function withOpenDemoInvoice(callContext: CallContext): Promise<CallContext> {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
        return callContext;
    }
    const stripe = getStripeClient();
    if (!stripe) {
        return callContext;
    }
    try {
        const { invoiceId, created } = await ensureOpenDemoInvoice({
            stripe,
            demo: callContext,
            invoiceId: process.env.DEMO_STRIPE_INVOICE_ID,
        });
        if (created) {
            console.log(`[voice/demo-call] previous demo invoice is spent; seeded ${invoiceId}.`);
        }
        return { ...callContext, stripeInvoiceId: invoiceId };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[voice/demo-call] could not refresh the demo invoice (${reason}); dialing with the stored id.`);
        return callContext;
    }
}

/**
 * Dials the demo call into a fresh LiveKit room; the voice worker picks it up.
 *
 * @param input.toPhoneNumber - E.164 number to ring
 * @returns The LiveKit room name and the context the call carries
 */
export async function placeDemoCall({ toPhoneNumber }: { toPhoneNumber: string }): Promise<{
    roomName: string;
    callContext: CallContext;
}> {
    const callContext = await withOpenDemoInvoice(getDemoCallContext());
    const { roomName } = await startCollectionCall({ toPhoneNumber, callContext });
    return { roomName, callContext };
}
