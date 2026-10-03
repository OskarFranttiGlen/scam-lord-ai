/**
 * @module text/twiml
 *
 * TwiML for Twilio Messaging webhooks: one `<Message>` reply, or an empty `<Response/>`.
 *
 * Depends on: (none)
 * Used by: /api/sms/inbound
 */

/**
 * Escapes text for an XML text node or attribute.
 *
 * @param value - Untrusted text
 */
function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * TwiML that replies with `reply`, or sends nothing when it is null or blank.
 *
 * @param reply - SMS reply text
 */
export function buildMessagingTwiml(reply: string | null): string {
    const head = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
    return reply?.trim()
        ? `${head}<Response><Message>${escapeXml(reply.trim())}</Message></Response>`
        : `${head}<Response/>`;
}
