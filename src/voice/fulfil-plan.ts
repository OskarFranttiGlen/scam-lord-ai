/**
 * @module voice/fulfil-plan
 *
 * Side effects after a tenant accepts an in-policy plan: write the plan into Stripe as
 * installment invoices (falling back to a Checkout link when the call's invoice is not in
 * Stripe), then text and/or email the first payment link. Never throws.
 *
 * Depends on: @/payments/stripe, @/messaging/send-payment-link, ./context
 * Used by: @/voice/tools (accept_plan)
 */

import {
    sendPaymentLinkMessages,
    type TPaymentLinkChannel,
    type TPaymentLinkResult,
} from "@/messaging/send-payment-link";
import {
    createPaymentLink,
    dollarsToCents,
    getStripeClient,
    writePaymentPlan,
} from "@/payments/stripe";
import type { CallContext, TAcceptedPlan } from "./context";

export type TPlanFulfilment = {
    url: string | null;
    source: "plan_invoice" | "hosted_invoice" | "checkout_session" | "none";
    /** Stripe invoice the tenant pays first, when there is one; confirm_payment checks it. */
    payInvoiceId?: string;
    messages: TPaymentLinkResult | null;
    error?: string;
};

type TLog = Pick<Console, "info" | "warn">;

type TLink = Pick<TPlanFulfilment, "url" | "source" | "payInvoiceId">;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Writes the plan onto the call's Stripe invoice and returns the first installment's link,
 * or null when the invoice is not in Stripe or cannot take a plan.
 *
 * @param stripe - Configured Stripe client
 * @param ctx - Call context with the Stripe invoice id
 * @param plan - Accepted plan in dollars
 * @param log - Logger
 */
async function linkFromPlanInvoices(
    stripe: NonNullable<ReturnType<typeof getStripeClient>>,
    ctx: CallContext,
    plan: TAcceptedPlan,
    log: TLog,
): Promise<TLink | null> {
    try {
        const invoice = await stripe.invoices.retrieve(ctx.stripeInvoiceId);
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) {
            return null;
        }
        const written = await writePaymentPlan({ stripe, invoiceId: ctx.stripeInvoiceId, customerId, plan });
        const first = written.installments[0];
        return first?.hostedInvoiceUrl
            ? { url: first.hostedInvoiceUrl, source: "plan_invoice", payInvoiceId: first.invoiceId }
            : null;
    } catch (error) {
        log.warn("[voice/fulfil-plan] plan not written to Stripe; using a Checkout link", {
            invoiceId: ctx.stripeInvoiceId,
            error: errorMessage(error),
        });
        return null;
    }
}

export type TFulfilOptions = {
    /**
     * Channels to message; defaults to SMS and email. Read once the link exists, so a caller
     * may widen it while waiting (the text thread adds SMS when Stripe is slow).
     */
    channels?: TPaymentLinkChannel[];
};

/**
 * Saves the accepted plan in Stripe and sends the first payment link by SMS and email.
 *
 * @param ctx - Call context (tenant, property, Stripe invoice)
 * @param plan - Accepted, policy-approved plan in dollars
 * @param log - Logger; defaults to console
 * @param options - Which channels to message
 */
export async function fulfilAcceptedPlan(
    ctx: CallContext,
    plan: TAcceptedPlan,
    log: TLog = console,
    options: TFulfilOptions = {},
): Promise<TPlanFulfilment> {
    const stripe = getStripeClient();
    if (!stripe) {
        log.warn("[voice/fulfil-plan] STRIPE_SECRET_KEY missing; no payment link sent");
        return { url: null, source: "none", messages: null, error: "stripe_not_configured" };
    }

    const firstAmount = plan.installments[0]?.amount ?? 0;
    let link = await linkFromPlanInvoices(stripe, ctx, plan, log);
    if (!link) {
        try {
            const created = await createPaymentLink({
                stripe,
                amountCents: dollarsToCents(firstAmount),
                currency: "usd",
                description: `${ctx.propertyName} rent, ${ctx.unitLabel}`,
                metadata: { scamlord_invoice_ref: ctx.stripeInvoiceId },
            });
            link = {
                url: created.url,
                source: created.source,
                payInvoiceId: created.source === "hosted_invoice" ? created.objectId : undefined,
            };
        } catch (error) {
            log.warn("[voice/fulfil-plan] payment link failed", { error: errorMessage(error) });
            return { url: null, source: "none", messages: null, error: errorMessage(error) };
        }
    }

    // Demo tenancies carry placeholder contact details; demo recipients come only from env.
    const messages = await sendPaymentLinkMessages({
        tenantName: ctx.tenantName,
        phone: process.env.DEMO_TENANT_PHONE?.trim() || ctx.phone,
        email: process.env.DEMO_TENANT_EMAIL?.trim() || ctx.email,
        propertyName: ctx.propertyName,
        amountDollars: firstAmount,
        url: link.url ?? "",
        channels: options.channels ?? ["sms", "email"],
    });
    log.info("[voice/fulfil-plan] payment link sent", {
        source: link.source,
        sms: messages.sms.status,
        email: messages.email.status,
    });

    return { ...link, messages };
}
