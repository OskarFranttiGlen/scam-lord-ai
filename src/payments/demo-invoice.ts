/**
 * @module payments/demo-invoice
 *
 * Keeps a finalized, open Stripe test invoice behind the demo tenancy. Writing a payment plan
 * closes the previous invoice (credit notes + `rescheduled` metadata), so demo calls need a
 * fresh one; this module reuses the stored invoice while it is still payable and re-seeds
 * otherwise. Callers must guard it behind an `sk_test_` key — the Stripe client cannot prove
 * which key it was built from.
 *
 * Depends on: stripe, ./stripe, @/voice/context
 * Used by: scripts/seed-stripe-demo.ts, scripts/call-tenant.ts
 */

import type Stripe from "stripe";

import type { CallContext } from "@/voice/context";

import { dollarsToCents, PLAN_STATUS_RESCHEDULED, STRIPE_METADATA } from "./stripe";

/** Customer metadata key marking the single reusable demo tenant. */
export const DEMO_CUSTOMER_KEY = "scamlord_demo_tenant";

export type TEnsureOpenDemoInvoiceInput = {
    stripe: Stripe;
    /** Demo tenancy snapshot the invoice must match (balance, due date, unit). */
    demo: CallContext;
    /** Stored invoice id (e.g. `DEMO_STRIPE_INVOICE_ID`); reused while still payable. */
    invoiceId?: string;
    /** Clock override for tests. */
    now?: Date;
};

export type TDemoInvoice = {
    invoiceId: string;
    /** True when a fresh invoice had to be seeded because the stored one was spent. */
    created: boolean;
};

function isRescheduled(invoice: Stripe.Invoice): boolean {
    return invoice.metadata?.[STRIPE_METADATA.planStatus] === PLAN_STATUS_RESCHEDULED;
}

/**
 * Returns the invoice id behind the demo tenancy, seeding a fresh invoice when the stored one
 * can no longer be paid (paid, void, rescheduled into a plan, deleted, or the balance changed).
 * Reuses the demo customer, creating it on first run.
 *
 * @param input - Stripe client, demo context, optional stored invoice id
 */
export async function ensureOpenDemoInvoice(input: TEnsureOpenDemoInvoiceInput): Promise<TDemoInvoice> {
    const { stripe, demo } = input;
    const storedId = input.invoiceId?.trim();
    const amountCents = dollarsToCents(demo.openBalance);

    if (storedId) {
        try {
            const stored = await stripe.invoices.retrieve(storedId);
            if (stored.status === "open" && stored.amount_remaining === amountCents && !isRescheduled(stored)) {
                return { invoiceId: stored.id, created: false };
            }
        } catch {
            // Deleted or unreadable invoice id: fall through and seed a fresh one.
        }
    }

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
        due_date: Math.max(dueDate, Math.floor((input.now ?? new Date()).getTime() / 1000) + 3600),
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: `${demo.propertyName} rent, ${demo.unitLabel}`,
    });
    await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: draft.id,
        amount: amountCents,
        currency: "usd",
        description: `September rent, ${demo.unitLabel}`,
    });
    const invoice = await stripe.invoices.finalizeInvoice(draft.id, { auto_advance: false });

    return { invoiceId: invoice.id, created: true };
}