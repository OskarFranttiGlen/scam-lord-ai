/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeTwilioSignature } from "@/messaging/twilio-signature";
import { handleInboundText } from "@/text/handle-inbound-text";
import { POST } from "../inbound/route";

vi.mock("next/server", async importOriginal => ({
    ...(await importOriginal<typeof import("next/server")>()),
    after: vi.fn(),
}));
vi.mock("@/text/handle-inbound-text", () => ({ handleInboundText: vi.fn() }));

const URL_PUBLIC = "https://rent.example.com/api/sms/inbound";
const TOKEN = "test_auth_token";
const PARAMS = { From: "+15555550201", To: "+15550000000", Body: "who is this?", MessageSid: "SM1" };

/**
 * A Twilio-style form POST to the webhook.
 *
 * @param signature - `X-Twilio-Signature` header, if any
 * @param params - Form params
 */
function inbound(signature: string | null, params: Record<string, string> = PARAMS): Request {
    return new Request("http://localhost:3000/api/sms/inbound", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            ...(signature ? { "x-twilio-signature": signature } : {}),
        },
        body: new URLSearchParams(params).toString(),
    });
}

beforeEach(() => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
    vi.stubEnv("TWILIO_WEBHOOK_URL", URL_PUBLIC);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(handleInboundText).mockResolvedValue({
        reply: "Hi, this is an AI assistant for Oak & <Pine>. You owe $1,840.",
        outcome: "replied",
        latencyMs: 5,
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe("POST /api/sms/inbound", () => {
    it("replies with escaped TwiML when Twilio's signature is valid", async () => {
        const signature = computeTwilioSignature(TOKEN, URL_PUBLIC, new URLSearchParams(PARAMS));

        const response = await POST(inbound(signature));

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/xml");
        expect(await response.text()).toBe(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Message>"
            + "Hi, this is an AI assistant for Oak &amp; &lt;Pine&gt;. You owe $1,840.</Message></Response>",
        );
        expect(handleInboundText).toHaveBeenCalledWith({ from: "+15555550201", body: "who is this?", messageSid: "SM1" });
    });

    it("rejects a missing or forged signature without running the agent", async () => {
        const forged = computeTwilioSignature("other_token", URL_PUBLIC, new URLSearchParams(PARAMS));

        expect((await POST(inbound(null))).status).toBe(403);
        expect((await POST(inbound(forged))).status).toBe(403);
        expect(handleInboundText).not.toHaveBeenCalled();
    });

    it("sends an empty response when there is nothing to say", async () => {
        vi.mocked(handleInboundText).mockResolvedValue({ reply: null, outcome: "keyword", latencyMs: 1 });
        const params = { ...PARAMS, Body: "STOP" };
        const signature = computeTwilioSignature(TOKEN, URL_PUBLIC, new URLSearchParams(params));

        const response = await POST(inbound(signature, params));

        expect(await response.text()).toBe("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>");
    });

    it("skips verification in development when no auth token is set", async () => {
        vi.stubEnv("TWILIO_AUTH_TOKEN", "");
        vi.stubEnv("NODE_ENV", "development");

        expect((await POST(inbound(null))).status).toBe(200);
        expect(console.warn).toHaveBeenCalled();
    });

    it("refuses unsigned traffic in production when no auth token is set", async () => {
        vi.stubEnv("TWILIO_AUTH_TOKEN", "");
        vi.stubEnv("NODE_ENV", "production");

        expect((await POST(inbound(null))).status).toBe(403);
        expect(handleInboundText).not.toHaveBeenCalled();
    });
});
