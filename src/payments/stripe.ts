/**
 * @module payments/stripe
 *
 * Server-only Stripe layer for collection calls (docs/SPEC.md → Call, Money). The tenant's
 * Stripe invoice is the only balance: payment links pay that invoice (or a destination-charge
 * Checkout Session tied to it), and an accepted plan is written back into Stripe as one
 * finalized invoice per installment while the overdue invoice is credited into the plan.
 *
 * Functions take the Stripe client as a parameter so in-call tools and the webhook can share
 * them and tests can pass a hand-rolled mock.
 *
 * Depends on: stripe, node:crypto
 * Used by: @/payments/webhook-events, /api/stripe/webhook, voice tools (`send_payment_link`,
 * `save_plan`, `confirm_payment`)
 */

import { createHash } from "node:crypto";

import Stripe from "stripe";

/** Invoice metadata keys written by this module. */
export const STRIPE_METADATA = {
    planStatus: "scamlord_plan_status",
    installmentInvoiceIds: "scamlord_installment_invoice_ids",
    feeWaiverCents: "scamlord_fee_waiver_cents",
    originalInvoiceId: "scamlord_original_invoice_id",
    installment: "scamlord_installment",
    destination: "scamlord_destination",
    invoiceId: "scamlord_invoice_id",
} as const;

/** Value of {@link STRIPE_METADATA.planStatus} once an invoice has been moved into a plan. */
export const PLAN_STATUS_RESCHEDULED = "rescheduled";

let cachedClient: Stripe | null = null;

/**
 * Returns the Stripe client for `STRIPE_SECRET_KEY`, or `null` when the key is unset.
 * Never import this into a client component.
 */
export function getStripeClient(): Stripe | null {
    if (cachedClient) {
        return cachedClient;
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        return null;
    }

    cachedClient = new Stripe(secretKey, { appInfo: { name: "ScamLord AI" } });
    return cachedClient;
}

/**
 * Converts a dollar amount to integer cents.
 *
 * @param dollars - Amount in dollars, e.g. 920.5
 */
export function dollarsToCents(dollars: number): number {
    return Math.round(dollars * 100);
}

/**
 * Converts integer cents to dollars.
 *
 * @param cents - Amount in cents
 */
export function centsToDollars(cents: number): number {
    return cents / 100;
}

function customerIdOf(invoice: Stripe.Invoice): string | null {
    const customer = invoice.customer;
    if (customer == null) {
        return null;
    }
    return typeof customer === "string" ? customer : customer.id;
}

function isRescheduled(invoice: Stripe.Invoice): boolean {
    return invoice.metadata?.[STRIPE_METADATA.planStatus] === PLAN_STATUS_RESCHEDULED;
}

function defaultReturnUrl(): string {
    const base = process.env.NEXT_PUBLIC_SITE_URL
        ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    return `${base.replace(/\/$/, "")}/?payment=complete`;
}

export type TPaymentLinkInput = {
    stripe: Stripe;
    /** Invoice the payment settles; enables the hosted-invoice path and webhook reconciliation. */
    invoiceId?: string;
    amountCents: number;
    currency: string;
    description: string;
    /** Landlord's connected account; makes the payment a destination charge. */
    connectedAccountId?: string;
    /** Prefills the Checkout Session customer. */
    customerId?: string;
    metadata?: Record<string, string>;
    /** Checkout return URL; defaults to the site root. */
    successUrl?: string;
};

export type TPaymentLink = {
    url: string;
    /** `hosted_invoice` pays the Stripe invoice directly; `checkout_session` is a destination-charge Checkout. */
    source: "hosted_invoice" | "checkout_session";
    /** Invoice id or Checkout Session id. */
    objectId: string;
};

/**
 * Returns a URL the tenant can pay. When the invoice is open for exactly `amountCents` and
 * its destination already matches (or none is requested), that is the invoice's hosted page,
 * so paying it marks the invoice paid in Stripe. Otherwise it creates a Checkout Session
 * (mode `payment`) whose PaymentIntent transfers to `connectedAccountId` (destination charge);
 * the webhook marks the invoice paid when that session completes.
 *
 * @param input - Stripe client, amount, currency, description, optional invoice and connected account
 */
export async function createPaymentLink(input: TPaymentLinkInput): Promise<TPaymentLink> {
    const { stripe, invoiceId, amountCents, currency, description, connectedAccountId } = input;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error(`amountCents must be a positive integer, got ${amountCents}`);
    }

    if (invoiceId) {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        const destinationMatches = !connectedAccountId
            || invoice.metadata?.[STRIPE_METADATA.destination] === connectedAccountId;
        if (
            invoice.status === "open"
            && invoice.hosted_invoice_url
            && invoice.amount_remaining === amountCents
            && destinationMatches
        ) {
            return { url: invoice.hosted_invoice_url, source: "hosted_invoice", objectId: invoice.id };
        }
    }

    const metadata: Record<string, string> = { ...input.metadata };
    if (invoiceId) {
        metadata[STRIPE_METADATA.invoiceId] = invoiceId;
    }

    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: input.customerId,
        line_items: [
            {
                quantity: 1,
                price_data: {
                    currency,
                    unit_amount: amountCents,
                    product_data: { name: description },
                },
            },
        ],
        payment_intent_data: {
            description,
            metadata,
            ...(connectedAccountId ? { transfer_data: { destination: connectedAccountId } } : {}),
        },
        metadata,
        success_url: input.successUrl ?? defaultReturnUrl(),
    });

    if (!session.url) {
        throw new Error(`Checkout Session ${session.id} has no URL`);
    }
    return { url: session.url, source: "checkout_session", objectId: session.id };
}

/** Accepted plan in dollars, matching the voice agent's `TAcceptedPlan`. */
export type TPlanInput = {
    installments: Array<{ date: string; amount: number }>;
    feeWaiver?: number;
};

export type TWritePaymentPlanInput = {
    stripe: Stripe;
    /** The overdue invoice the plan replaces. */
    invoiceId: string;
    customerId: string;
    plan: TPlanInput;
    /** Landlord's connected account; each installment invoice becomes a destination charge. */
    connectedAccountId?: string;
    /** Clock override for tests. */
    now?: Date;
};

export type TPlanInstallmentInvoice = {
    invoiceId: string;
    dueDate: string;
    amountCents: number;
    hostedInvoiceUrl: string | null;
};

export type TWrittenPaymentPlan = {
    originalInvoiceId: string;
    installments: TPlanInstallmentInvoice[];
    creditNoteIds: string[];
    feeWaiverCents: number;
    /** True when the original invoice was already rescheduled and nothing new was written. */
    alreadyWritten: boolean;
};

/** Plan amounts do not reconcile with the open invoice. */
export class PaymentPlanMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PaymentPlanMismatchError";
    }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * End of the plan day in UTC, pushed at least an hour out because Stripe rejects past due dates.
 *
 * @param date - YYYY-MM-DD
 * @param now - Current time
 */
function dueDateTimestamp(date: string, now: Date): number {
    const [year, month, day] = date.split("-").map(Number);
    const endOfDay = Math.floor(Date.UTC(year, month - 1, day, 23, 59, 59) / 1000);
    const earliest = Math.floor(now.getTime() / 1000) + 3600;
    return Math.max(endOfDay, earliest);
}

function planKey(invoiceId: string, plan: TPlanInput, connectedAccountId?: string): string {
    const hash = createHash("sha256")
        .update(JSON.stringify({ plan, connectedAccountId: connectedAccountId ?? null }))
        .digest("hex")
        .slice(0, 16);
    return `scamlord-plan-${invoiceId}-${hash}`;
}

async function readWrittenPlan(stripe: Stripe, original: Stripe.Invoice): Promise<TWrittenPaymentPlan> {
    const ids = (original.metadata?.[STRIPE_METADATA.installmentInvoiceIds] ?? "")
        .split(",")
        .filter(Boolean);
    const invoices = await Promise.all(ids.map(id => stripe.invoices.retrieve(id)));
    const creditNotes = await stripe.creditNotes.list({ invoice: original.id, limit: 10 });
    return {
        originalInvoiceId: original.id,
        installments: invoices.map(invoice => ({
            invoiceId: invoice.id,
            dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString().slice(0, 10) : "",
            amountCents: invoice.amount_due,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        })),
        creditNoteIds: creditNotes.data.map(note => note.id),
        feeWaiverCents: Number(original.metadata?.[STRIPE_METADATA.feeWaiverCents] ?? 0),
        alreadyWritten: true,
    };
}

/**
 * Writes an accepted plan into Stripe:
 * 1. One `send_invoice` invoice per installment, due on the plan date, finalized so it has a
 *    hosted payment page (and `transfer_data.destination` when a connected account is given).
 * 2. The overdue invoice's metadata records the installment invoice ids.
 * 3. A credit note for the fee waiver (if any) and one for the rescheduled balance close the
 *    overdue invoice, so the open amount lives only on the installment invoices.
 *
 * Installments plus the waiver must equal the invoice's `amount_remaining`. Idempotent: a
 * rescheduled invoice returns the plan already written, and every create uses an idempotency key.
 *
 * @param input - Stripe client, overdue invoice id, customer id, plan in dollars, optional connected account
 */
export async function writePaymentPlan(input: TWritePaymentPlanInput): Promise<TWrittenPaymentPlan> {
    const { stripe, invoiceId, customerId, plan, connectedAccountId } = input;
    const now = input.now ?? new Date();

    const original = await stripe.invoices.retrieve(invoiceId);
    if (isRescheduled(original)) {
        return readWrittenPlan(stripe, original);
    }
    if (customerIdOf(original) !== customerId) {
        throw new PaymentPlanMismatchError(`Invoice ${invoiceId} does not belong to customer ${customerId}`);
    }
    if (original.status !== "open") {
        throw new PaymentPlanMismatchError(`Invoice ${invoiceId} is ${original.status ?? "unknown"}, not open`);
    }
    if (plan.installments.length === 0) {
        throw new PaymentPlanMismatchError("A plan needs at least one installment");
    }

    const rows = plan.installments.map(row => {
        if (!ISO_DATE.test(row.date)) {
            throw new PaymentPlanMismatchError(`Installment date must be YYYY-MM-DD, got ${row.date}`);
        }
        const amountCents = dollarsToCents(row.amount);
        if (amountCents <= 0) {
            throw new PaymentPlanMismatchError(`Installment amount must be positive, got ${row.amount}`);
        }
        return { date: row.date, amountCents };
    });
    const feeWaiverCents = dollarsToCents(plan.feeWaiver ?? 0);
    const scheduledCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    if (scheduledCents + feeWaiverCents !== original.amount_remaining) {
        throw new PaymentPlanMismatchError(
            `Installments (${scheduledCents}) plus waiver (${feeWaiverCents}) must equal the open `
            + `balance (${original.amount_remaining}) in cents`,
        );
    }

    const key = planKey(invoiceId, plan, connectedAccountId);
    const label = original.number ?? original.id;
    const installments: TPlanInstallmentInvoice[] = [];

    for (const [index, row] of rows.entries()) {
        const position = `${index + 1}/${rows.length}`;
        const metadata: Record<string, string> = {
            [STRIPE_METADATA.originalInvoiceId]: original.id,
            [STRIPE_METADATA.installment]: position,
        };
        if (connectedAccountId) {
            metadata[STRIPE_METADATA.destination] = connectedAccountId;
        }

        const draft = await stripe.invoices.create(
            {
                customer: customerId,
                currency: original.currency,
                collection_method: "send_invoice",
                due_date: dueDateTimestamp(row.date, now),
                auto_advance: false,
                pending_invoice_items_behavior: "exclude",
                description: `Payment plan installment ${position} for invoice ${label}`,
                metadata,
                ...(connectedAccountId ? { transfer_data: { destination: connectedAccountId } } : {}),
            },
            { idempotencyKey: `${key}-${index}-invoice` },
        );
        await stripe.invoiceItems.create(
            {
                customer: customerId,
                invoice: draft.id,
                amount: row.amountCents,
                currency: original.currency,
                description: `Installment ${position} due ${row.date}`,
                metadata,
            },
            { idempotencyKey: `${key}-${index}-item` },
        );
        const finalized = await stripe.invoices.finalizeInvoice(
            draft.id,
            { auto_advance: false },
            { idempotencyKey: `${key}-${index}-finalize` },
        );
        installments.push({
            invoiceId: finalized.id,
            dueDate: row.date,
            amountCents: row.amountCents,
            hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        });
    }

    const installmentIds = installments.map(row => row.invoiceId).join(",");
    await stripe.invoices.update(original.id, {
        metadata: {
            [STRIPE_METADATA.planStatus]: PLAN_STATUS_RESCHEDULED,
            [STRIPE_METADATA.installmentInvoiceIds]: installmentIds,
            [STRIPE_METADATA.feeWaiverCents]: String(feeWaiverCents),
        },
    });

    const creditNoteIds: string[] = [];
    if (feeWaiverCents > 0) {
        const waiver = await stripe.creditNotes.create(
            {
                invoice: original.id,
                amount: feeWaiverCents,
                memo: "Late fee waived under the landlord's collection policy.",
                metadata: { scamlord_credit: "fee_waiver" },
            },
            { idempotencyKey: `${key}-credit-waiver` },
        );
        creditNoteIds.push(waiver.id);
    }
    const moved = await stripe.creditNotes.create(
        {
            invoice: original.id,
            amount: scheduledCents,
            memo: `Balance moved to payment plan invoices ${installmentIds.replaceAll(",", ", ")}.`,
            metadata: { scamlord_credit: "rescheduled", [STRIPE_METADATA.installmentInvoiceIds]: installmentIds },
        },
        { idempotencyKey: `${key}-credit-rescheduled` },
    );
    creditNoteIds.push(moved.id);

    return { originalInvoiceId: original.id, installments, creditNoteIds, feeWaiverCents, alreadyWritten: false };
}

export type TInvoicePaymentStatus = {
    invoiceId: string;
    status: Stripe.Invoice.Status | null;
    /** Money actually arrived (not just credited into a plan). */
    paid: boolean;
    /** The invoice was closed by credit notes and its balance now lives on installment invoices. */
    rescheduled: boolean;
    installmentInvoiceIds: string[];
    amountDueCents: number;
    amountPaidCents: number;
    amountRemainingCents: number;
    currency: string;
    hostedInvoiceUrl: string | null;
};

/**
 * Reads whether an invoice has been paid. A rescheduled invoice reports `paid: false` and
 * lists its installment invoices; check the installment the tenant is paying instead.
 *
 * @param input - Stripe client and invoice id
 */
export async function getInvoicePaymentStatus(input: {
    stripe: Stripe;
    invoiceId: string;
}): Promise<TInvoicePaymentStatus> {
    const invoice = await input.stripe.invoices.retrieve(input.invoiceId);
    const rescheduled = isRescheduled(invoice);
    return {
        invoiceId: invoice.id,
        status: invoice.status,
        paid: invoice.status === "paid" && !rescheduled,
        rescheduled,
        installmentInvoiceIds: (invoice.metadata?.[STRIPE_METADATA.installmentInvoiceIds] ?? "")
            .split(",")
            .filter(Boolean),
        amountDueCents: invoice.amount_due,
        amountPaidCents: invoice.amount_paid,
        amountRemainingCents: invoice.amount_remaining,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    };
}
