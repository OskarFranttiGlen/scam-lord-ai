import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendSms } from "../sms";

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15550001111");
});

afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("sendSms", () => {
    it("posts a form-encoded message with basic auth and returns the SID", async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ sid: "SM42" }), { status: 201 }));

        const result = await sendSms({ to: "+15555550102", body: "Hello" });

        expect(result).toEqual({ sid: "SM42" });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers.authorization).toBe(`Basic ${Buffer.from("AC123:secret-token").toString("base64")}`);
        const body = new URLSearchParams(String(init.body));
        expect(body.get("To")).toBe("+15555550102");
        expect(body.get("From")).toBe("+15550001111");
        expect(body.get("Body")).toBe("Hello");
    });

    it("throws with Twilio's error message on a non-2xx response", async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }), { status: 400 }),
        );

        await expect(sendSms({ to: "+1", body: "x" })).rejects.toThrow(
            "Twilio SMS failed with HTTP 400 (code 21211): Invalid 'To' Phone Number",
        );
    });

    it("names the missing env keys without calling Twilio", async () => {
        vi.stubEnv("TWILIO_AUTH_TOKEN", "");
        vi.stubEnv("TWILIO_PHONE_NUMBER", "");

        await expect(sendSms({ to: "+15555550102", body: "x" })).rejects.toThrow(
            "missing TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
