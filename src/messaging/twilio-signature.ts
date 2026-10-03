/**
 * @module messaging/twilio-signature
 *
 * Verifies Twilio's `X-Twilio-Signature` webhook header: base64 HMAC-SHA1, keyed with the
 * account auth token, over the full public URL followed by every POST param (sorted by name,
 * name then value, no separators). Behind a tunnel or proxy the URL Twilio signed is the public
 * one, so `TWILIO_WEBHOOK_URL` can pin it.
 *
 * Depends on: node:crypto
 * Used by: /api/sms/inbound
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Computes the signature Twilio sends for a form-encoded webhook.
 *
 * @param authToken - Twilio account auth token
 * @param url - Full URL Twilio requested, including any query string
 * @param params - POST body params
 */
export function computeTwilioSignature(authToken: string, url: string, params: URLSearchParams): string {
    const payload = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .reduce((acc, [key, value]) => acc + key + value, url);
    return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

/**
 * True when the header matches the expected signature (timing-safe).
 *
 * @param input.authToken - Twilio account auth token
 * @param input.url - Full public URL Twilio requested
 * @param input.params - POST body params
 * @param input.signature - `X-Twilio-Signature` header value
 */
export function isValidTwilioSignature(input: {
    authToken: string;
    url: string;
    params: URLSearchParams;
    signature: string | null;
}): boolean {
    if (!input.signature) {
        return false;
    }
    const expected = Buffer.from(computeTwilioSignature(input.authToken, input.url, input.params));
    const actual = Buffer.from(input.signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The URL Twilio signed: the configured override, else the request URL rebuilt from
 * `x-forwarded-proto` / `x-forwarded-host` (or `host`).
 *
 * @param request - Incoming webhook request
 * @param override - Public webhook URL from `TWILIO_WEBHOOK_URL`
 */
export function resolveTwilioWebhookUrl(request: Request, override?: string): string {
    const configured = override?.trim();
    if (configured) {
        return configured;
    }
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
    return `${proto || url.protocol.slice(0, -1)}://${host || url.host}${url.pathname}${url.search}`;
}
