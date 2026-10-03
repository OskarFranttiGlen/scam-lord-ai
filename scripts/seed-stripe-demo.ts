/**
 * @module scripts/seed-stripe-demo
 *
 * Prints a finalized, open Stripe test invoice for the demo tenancy (John Reyes, Sunset Apartments,
 * $2400) so `accept_plan` writes real installment invoices instead of falling back to Checkout.
 * Reuses the stored `DEMO_STRIPE_INVOICE_ID` while it is still payable and re-seeds otherwise,
 * because writing a plan closes the previous invoice. Refuses to run against a live key.
 *
 * Run:
 * ```bash
 * npx tsx scripts/seed-stripe-demo.ts
 * ```
 * Then set the printed `DEMO_STRIPE_INVOICE_ID` in `.env` and restart the voice worker.
 *
 * Depends on: dotenv, @/payments/demo-invoice, @/payments/stripe, @/voice/demo-context
 * Used by: manual demo setup
 */

import "dotenv/config";

import { ensureOpenDemoInvoice } from "../src/payments/demo-invoice";
import { getStripeClient } from "../src/payments/stripe";
import { getDemoCallContext } from "../src/voice/demo-context";

async function main(): Promise<void> {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
        throw new Error("STRIPE_SECRET_KEY must be a test key (sk_test_…) to seed demo data");
    }
    const stripe = getStripeClient();
    if (!stripe) {
        throw new Error("STRIPE_SECRET_KEY missing");
    }
    const demo = getDemoCallContext();

    const { invoiceId, created } = await ensureOpenDemoInvoice({
        stripe,
        demo,
        invoiceId: process.env.DEMO_STRIPE_INVOICE_ID,
    });
    console.log(`[seed-stripe-demo] invoice ${invoiceId} (${created ? "seeded" : "reused"}, open $${demo.openBalance})`);
    console.log(`DEMO_STRIPE_INVOICE_ID=${invoiceId}`);
}

main().catch((error: unknown) => {
    console.error("[seed-stripe-demo]", error instanceof Error ? error.message : error);
    process.exit(1);
});