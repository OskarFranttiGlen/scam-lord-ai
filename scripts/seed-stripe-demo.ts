/**
 * @module scripts/seed-stripe-demo
 *
 * Creates a finalized, open Stripe test invoice for the demo tenancy (Jordan Lee, Maple Court,
 * $1840) so `accept_plan` writes real installment invoices instead of falling back to Checkout.
 * Reuses one demo customer; each run makes a fresh invoice, because writing a plan closes the
 * previous one. Refuses to run against a live key.
 *
 * Run:
 * ```bash
 * npx tsx scripts/seed-stripe-demo.ts
 * ```
 * Then set the printed `DEMO_STRIPE_INVOICE_ID` in `.env` and restart the voice worker.
 *
 * Depends on: dotenv, @/payments/stripe, @/voice/demo-context
 * Used by: manual demo setup
 */

import "dotenv/config";

import { dollarsToCents, getStripeClient } from "../src/payments/stripe";
import { getDemoCallContext } from "../src/voice/demo-context";

const DEMO_CUSTOMER_KEY = "scamlord_demo_tenant";

async function main(): Promise<void> {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
        throw new Error("STRIPE_SECRET_KEY must be a test key (sk_test_…) to seed demo data");
    }
    const stripe = getStripeClient();
    if (!stripe) {
        throw new Error("STRIPE_SECRET_KEY missing");
    }
    const demo = getDemoCallContext();

    const found = await stripe.customers.search({ query: `metadata['${DEMO_CUSTOMER_KEY}']:'true'` });
    const customer = found.data[0] ?? await stripe.customers.create({
        name: demo.tenantName,
        email: process.env.DEMO_TENANT_EMAIL?.trim() || demo.email,
        phone: process.env.DEMO_TENANT_PHONE?.trim() || demo.phone,
        metadata: { [DEMO_CUSTOMER_KEY]: "true" },
    });

    const dueDate = Math.floor(new Date(`${demo.invoiceDueDate}T23:59:59Z`).getTime() / 1000);
    const draft = await stripe.invoices.create({
        customer: customer.id,
        currency: "usd",
        collection_method: "send_invoice",
        due_date: Math.max(dueDate, Math.floor(Date.now() / 1000) + 3600),
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: `${demo.propertyName} rent, ${demo.unitLabel}`,
    });
    await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: draft.id,
        amount: dollarsToCents(demo.openBalance),
        currency: "usd",
        description: `September rent, ${demo.unitLabel}`,
    });
    const invoice = await stripe.invoices.finalizeInvoice(draft.id, { auto_advance: false });

    console.log(`[seed-stripe-demo] customer ${customer.id}, invoice ${invoice.id} (${invoice.status}, $${invoice.amount_remaining / 100})`);
    console.log(`DEMO_STRIPE_INVOICE_ID=${invoice.id}`);
}

main().catch((error: unknown) => {
    console.error("[seed-stripe-demo]", error instanceof Error ? error.message : error);
    process.exit(1);
});
