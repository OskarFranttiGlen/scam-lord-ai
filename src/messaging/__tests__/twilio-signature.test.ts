/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { computeTwilioSignature, isValidTwilioSignature, resolveTwilioWebhookUrl } from "../twilio-signature";

/** Twilio's documented example (webhooks security guide): token, URL, params, and signature. */
const DOC_TOKEN = "12345";
const DOC_URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const DOC_PARAMS = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
};
const DOC_SIGNATURE = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";

describe("Twilio signature", () => {
    it("matches Twilio's documented example", () => {
        expect(computeTwilioSignature(DOC_TOKEN, DOC_URL, new URLSearchParams(DOC_PARAMS))).toBe(DOC_SIGNATURE);
    });

    it("accepts the documented signature regardless of param order", () => {
        const reversed = new URLSearchParams(Object.entries(DOC_PARAMS).reverse());

        expect(isValidTwilioSignature({
            authToken: DOC_TOKEN,
            url: DOC_URL,
            params: reversed,
            signature: DOC_SIGNATURE,
        })).toBe(true);
    });

    it("rejects a tampered body, wrong URL, or missing header", () => {
        const tampered = new URLSearchParams({ ...DOC_PARAMS, Digits: "9999" });
        const base = { authToken: DOC_TOKEN, url: DOC_URL, params: new URLSearchParams(DOC_PARAMS) };

        expect(isValidTwilioSignature({ ...base, params: tampered, signature: DOC_SIGNATURE })).toBe(false);
        expect(isValidTwilioSignature({ ...base, url: "https://evil.example/myapp.php", signature: DOC_SIGNATURE }))
            .toBe(false);
        expect(isValidTwilioSignature({ ...base, signature: null })).toBe(false);
        expect(isValidTwilioSignature({ ...base, signature: "short" })).toBe(false);
    });
});

describe("resolveTwilioWebhookUrl", () => {
    it("prefers the configured public URL", () => {
        const request = new Request("http://localhost:3000/api/sms/inbound");

        expect(resolveTwilioWebhookUrl(request, "https://abc.ngrok.app/api/sms/inbound"))
            .toBe("https://abc.ngrok.app/api/sms/inbound");
    });

    it("rebuilds the public URL from forwarded headers behind a proxy", () => {
        const request = new Request("http://localhost:3000/api/sms/inbound?x=1", {
            headers: { "x-forwarded-proto": "https", "x-forwarded-host": "rent.example.com" },
        });

        expect(resolveTwilioWebhookUrl(request)).toBe("https://rent.example.com/api/sms/inbound?x=1");
    });
});
