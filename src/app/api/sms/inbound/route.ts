/**
 * @module sms/inbound
 *
 * Twilio Messaging webhook (docs/SPEC.md, Text). Checks `X-Twilio-Signature`, runs one agent
 * turn for the sender, and answers with TwiML. Twilio gives up after 15 s, so the turn must
 * finish well inside that; slow follow-up work runs in `after()`.
 *
 * Env: `TWILIO_AUTH_TOKEN` (signature key), `TWILIO_WEBHOOK_URL` (public URL Twilio posts to,
 * when a tunnel or proxy rewrites the host).
 *
 * Depends on: next/server, @/messaging/twilio-signature, @/text/handle-inbound-text, @/text/twiml
 * Used by: Twilio (phone number → Messaging → "A message comes in" webhook)
 */

import { after } from "next/server";

import { isValidTwilioSignature, resolveTwilioWebhookUrl } from "@/messaging/twilio-signature";
import { handleInboundText } from "@/text/handle-inbound-text";
import { splitLinkReply } from "@/text/split-link-reply";
import { buildMessagingTwiml } from "@/text/twiml";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * True when the request is signed by Twilio, or when signing is off in local development.
 *
 * @param request - Incoming webhook request
 * @param params - Parsed form body
 */
function isAuthorized(request: Request, params: URLSearchParams): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) {
        if (process.env.NODE_ENV === "production") {
            console.error("[sms/inbound] TWILIO_AUTH_TOKEN is not set; rejecting unsigned webhook");
            return false;
        }
        console.warn("[sms/inbound] TWILIO_AUTH_TOKEN is not set; skipping signature check (development only)");
        return true;
    }
    return isValidTwilioSignature({
        authToken,
        url: resolveTwilioWebhookUrl(request, process.env.TWILIO_WEBHOOK_URL),
        params,
        signature: request.headers.get("x-twilio-signature"),
    });
}

/**
 * POST form body from Twilio: `From`, `To`, `Body`, `MessageSid`, and more.
 *
 * @param request - Twilio webhook request
 */
export async function POST(request: Request): Promise<Response> {
    const params = new URLSearchParams(await request.text());
    if (!isAuthorized(request, params)) {
        return new Response("Forbidden", { status: 403 });
    }

    const result = await handleInboundText({
        from: params.get("From") ?? "",
        body: params.get("Body") ?? "",
        messageSid: params.get("MessageSid") ?? undefined,
    });
    if (result.background) {
        const background = result.background;
        after(() => background);
    }

    // A reply with a payment link goes out as two texts so each stays short enough for Twilio
    // trial accounts (docs/SPEC.md, Text).
    return new Response(buildMessagingTwiml(result.reply === null ? null : splitLinkReply(result.reply)), {
        status: 200,
        headers: { "content-type": "text/xml; charset=utf-8" },
    });
}
