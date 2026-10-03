/**
 * @module messaging/send-payment-link
 *
 * Sends the same Stripe payment link by Twilio SMS and Resend email in parallel (docs/SPEC.md,
 * Call step 8). The SMS goes as two texts: the message, then the bare link. A missing address or an unrequested channel skips that channel; a failed channel
 * is logged and reported, never thrown, so the call can keep going. The text invites a reply,
 * which reaches the same agent through /api/sms/inbound.
 *
 * Depends on: ./sms, ./email
 * Used by: @/voice/fulfil-plan.ts
 */

import { sendEmail } from "./email";
import { sendSms } from "./sms";

export type TPaymentLinkInput = {
    tenantName: string;
    /** E.164; omitted or blank skips SMS. */
    phone?: string;
    /** Omitted or blank skips email. */
    email?: string;
    propertyName: string;
    amountDollars: number;
    /** Stripe hosted payment URL. */
    url: string;
    /** Channels to send on; defaults to both. */
    channels?: TPaymentLinkChannel[];
};

export type TPaymentLinkChannel = "sms" | "email";

export type TChannelResult =
    | { status: "sent"; id: string }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string };

export type TPaymentLinkResult = {
    sms: TChannelResult;
    email: TChannelResult;
    /** True when at least one channel delivered. */
    anySent: boolean;
};

/**
 * Formats dollars as `$1,840` or `$920.50`.
 *
 * @param amountDollars - Amount in dollars
 */
export function formatDollars(amountDollars: number): string {
    const whole = Number.isInteger(amountDollars);
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
    }).format(amountDollars);
}

/**
 * First word of the tenant's name, for a friendly greeting.
 *
 * @param tenantName - Full tenant name
 */
function firstName(tenantName: string): string {
    return tenantName.trim().split(/\s+/)[0] || "there";
}

/**
 * Escapes text for safe interpolation into HTML.
 *
 * @param value - Untrusted text
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Builds the first SMS: short, plain, property + amount. The link follows in its own text.
 *
 * @param input - Payment link details
 */
export function buildPaymentLinkSms(input: TPaymentLinkInput): string {
    return `Hi ${firstName(input.tenantName)}, thanks for talking with us. `
        + `Your secure link to pay ${formatDollars(input.amountDollars)} for ${input.propertyName} is in the next text. `
        + "Questions? Just reply here.";
}

/**
 * Texts the message, then the bare link on its own, so each stays short enough for Twilio trial
 * accounts (which reject long multi-segment texts). The link text decides the result.
 *
 * @param phone - E.164 number
 * @param input - Payment link details
 */
async function sendLinkTexts(phone: string, input: TPaymentLinkInput): Promise<string> {
    await sendSms({ to: phone, body: buildPaymentLinkSms(input) }).catch((error: unknown) => {
        console.error(`[messaging] payment link intro sms failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return (await sendSms({ to: phone, body: input.url })).sid;
}

/**
 * Builds the email subject, plain-text body, and HTML body.
 *
 * @param input - Payment link details
 */
export function buildPaymentLinkEmail(input: TPaymentLinkInput): { subject: string; text: string; html: string } {
    const name = firstName(input.tenantName);
    const amount = formatDollars(input.amountDollars);
    const subject = `Your payment link for ${input.propertyName}`;
    const text = [
        `Hi ${name},`,
        "",
        `Thanks for talking with us today. Here's your secure link to pay ${amount} for ${input.propertyName}:`,
        "",
        input.url,
        "",
        "If anything looks off, just reply to this email.",
        "",
        `${input.propertyName} management`,
    ].join("\n");
    const safeUrl = escapeHtml(input.url);
    const html = [
        `<p>Hi ${escapeHtml(name)},</p>`,
        `<p>Thanks for talking with us today. Here's your secure link to pay <strong>${escapeHtml(amount)}</strong> `
        + `for ${escapeHtml(input.propertyName)}:</p>`,
        `<p><a href="${safeUrl}">Pay ${escapeHtml(amount)}</a></p>`,
        "<p>If anything looks off, just reply to this email.</p>",
        `<p>${escapeHtml(input.propertyName)} management</p>`,
    ].join("\n");
    return { subject, text, html };
}

/**
 * Runs one channel send, converting thrown errors into a logged `failed` result.
 *
 * @param channel - Channel label for logs
 * @param send - Send function resolving to the provider id
 */
async function settle(channel: "sms" | "email", send: () => Promise<string>): Promise<TChannelResult> {
    try {
        return { status: "sent", id: await send() };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[messaging] payment link ${channel} failed: ${message}`);
        return { status: "failed", error: message };
    }
}

/**
 * Sends the payment link by SMS and email in parallel. Never throws.
 *
 * @param input - Tenant, addresses, property, amount, and Stripe URL
 */
export async function sendPaymentLinkMessages(input: TPaymentLinkInput): Promise<TPaymentLinkResult> {
    const phone = input.phone?.trim();
    const email = input.email?.trim();
    const channels = input.channels ?? ["sms", "email"];
    const skip = (reason: string) => Promise.resolve<TChannelResult>({ status: "skipped", reason });

    const [sms, emailResult] = await Promise.all([
        !channels.includes("sms")
            ? skip("sms not requested")
            : phone
                ? settle("sms", () => sendLinkTexts(phone, input))
                : skip("no phone number"),
        !channels.includes("email")
            ? skip("email not requested")
            : email
                ? settle("email", async () => (await sendEmail({ to: email, ...buildPaymentLinkEmail(input) })).id)
                : skip("no email address"),
    ]);

    return { sms, email: emailResult, anySent: sms.status === "sent" || emailResult.status === "sent" };
}
