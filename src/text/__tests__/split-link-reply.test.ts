/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { splitLinkReply } from "@/text/split-link-reply";

describe("splitLinkReply", () => {
    it("returns a reply without a URL unchanged as one text", () => {
        const reply = "Hi, this is an AI assistant for Maple Court. You owe $1,840.";

        expect(splitLinkReply(reply)).toEqual([reply]);
    });

    it("splits a payment-link reply into tidied words and the bare link", () => {
        expect(splitLinkReply(
            "You're all set: $920 today and $920 on Fri Oct 9. "
            + "Pay the first $920 here: https://checkout.stripe.com/c/pay/cs_test_1?s=ap I emailed it to you too.",
        )).toEqual([
            "You're all set: $920 today and $920 on Fri Oct 9. "
            + "Pay the first $920 with the link in the next text. I emailed it to you too.",
            "https://checkout.stripe.com/c/pay/cs_test_1?s=ap",
        ]);
    });

    it("keeps sentence punctuation stuck to the link out of the bare link", () => {
        expect(splitLinkReply("Your new total is $1,840. Pay it here: https://pay.example.com/x, then you're done."))
            .toEqual([
                "Your new total is $1,840. Pay it with the link in the next text, then you're done.",
                "https://pay.example.com/x",
            ]);
    });

    it("ends the first text with a period when the link ended the reply", () => {
        expect(splitLinkReply("Pay the first $920 here: https://pay.example.com/abc"))
            .toEqual([
                "Pay the first $920 with the link in the next text.",
                "https://pay.example.com/abc",
            ]);
    });
});