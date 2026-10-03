/**
 * @module text/twiml
 *
 * TwiML for Twilio Messaging webhooks: one `<Message>` per reply text, or an empty `<Response/>`.
 * Multiple `<Message>` elements make Twilio send multiple SMS texts.
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
 * TwiML that replies with each text in its own `<Message>`, or sends nothing when they are all
 * null or blank.
 *
 * @param reply - One reply text, several texts (e.g. words then a bare link), or `null` for none
 */
export function buildMessagingTwiml(reply: string | readonly string[] | null): string {
    const messages = (typeof reply === "string" ? [reply] : reply ?? [])
        .map((message) => message.trim())
        .filter((message) => message.length > 0)
        .map((message) => `<Message>${escapeXml(message)}</Message>`);
    const head = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
    return messages.length > 0 ? `${head}<Response>${messages.join("")}</Response>` : `${head}<Response/>`;
}
