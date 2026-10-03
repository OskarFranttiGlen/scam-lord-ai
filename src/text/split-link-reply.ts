/**
 * @module text/split-link-reply
 *
 * Twilio trial accounts reject long multi-segment texts, so a reply that carries a payment link
 * goes out as two short texts: the words, then the bare link — the same pattern as
 * @/messaging/send-payment-link. This module splits an agent reply into those texts.
 *
 * Depends on: (none)
 * Used by: /api/sms/inbound
 */

/** A bare URL; trial replies carry one Stripe payment link. */
const URL_PATTERN = /https?:\/\/\S+/gi;

/** Sentence punctuation that sticks to a URL's tail when it sits before a space. */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

/** The phrase that replaces the URL in the first text, pointing at the second. */
const LINK_PHRASE = "the link in the next text";

/**
 * Splits a reply into the texts to send so each stays short enough for Twilio trial accounts.
 * A reply with no URL comes back unchanged as one text. Otherwise the URL moves to its own text
 * and the first text points at it, with "here:" style leftovers tidied up. The first URL wins;
 * agent replies carry a single payment link.
 *
 * @param reply - Agent reply text
 * @returns Texts to send, in order
 */
export function splitLinkReply(reply: string): string[] {
    const urls: string[] = [];
    const text = reply.replace(URL_PATTERN, (match) => {
        const tail = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
        urls.push(match.slice(0, match.length - tail.length));
        return `${LINK_PHRASE}${tail}`;
    });
    if (urls.length === 0) {
        return [reply];
    }
    return [tidy(text), urls[0]];
}

/**
 * Cleans up the first text around the inserted link phrase.
 *
 * @param text - Reply text with every URL already replaced by the link phrase
 */
function tidy(text: string): string {
    const tidied = text
        // "…here: the link in the next text" → "…with the link in the next text"
        .replace(/\bhere:?\s+the link in the next text/gi, "with the link in the next text")
        // Close the sentence before a following one instead of running on
        .replace(/(the link in the next text)(?=\s+[A-Z])/g, "$1.")
        .replace(/ {2,}/g, " ")
        .trim();
    // The URL swallowed the reply's closing period
    return /[A-Za-z0-9]$/.test(tidied) ? `${tidied}.` : tidied;
}