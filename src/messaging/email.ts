/**
 * @module messaging/email
 *
 * Sends one transactional email through the Resend REST API (plain `fetch`, no SDK).
 *
 * Env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified sender, e.g. `ScamLord AI <rent@yourdomain.com>`).
 *
 * Depends on: global fetch
 * Used by: @/messaging/send-payment-link.ts
 */

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export type TEmailInput = {
    to: string;
    subject: string;
    text: string;
    html?: string;
};

export type TEmailResult = {
    /** Resend email id, stored on the call row. */
    id: string;
};

/**
 * Sends an email via Resend. Throws on missing config or a non-2xx response.
 *
 * @param input - Recipient, subject, and plain-text (plus optional HTML) body
 */
export async function sendEmail(input: TEmailInput): Promise<TEmailResult> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();
    if (!apiKey || !from) {
        const missing = [!apiKey && "RESEND_API_KEY", !from && "RESEND_FROM_EMAIL"].filter(Boolean);
        throw new Error(`Resend email is not configured: missing ${missing.join(", ")}`);
    }

    const response = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            from,
            to: [input.to],
            subject: input.subject,
            text: input.text,
            ...(input.html ? { html: input.html } : {}),
        }),
    });

    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok || !payload.id) {
        const detail = payload.message ?? payload.name ?? "no error message";
        throw new Error(`Resend email failed with HTTP ${response.status}: ${detail}`);
    }
    return { id: payload.id };
}
