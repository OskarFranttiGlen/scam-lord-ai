import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "../email";

const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "Rent <rent@example.com>");
});

afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("sendEmail", () => {
    it("posts JSON to Resend with bearer auth and returns the id", async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));

        const result = await sendEmail({ to: "t@example.com", subject: "S", text: "T", html: "<p>T</p>" });

        expect(result).toEqual({ id: "email_1" });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.resend.com/emails");
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
        expect(JSON.parse(String(init.body))).toEqual({
            from: "Rent <rent@example.com>",
            to: ["t@example.com"],
            subject: "S",
            text: "T",
            html: "<p>T</p>",
        });
    });

    it("throws with Resend's error message on a non-2xx response", async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ name: "validation_error", message: "Domain not verified" }), { status: 403 }),
        );

        await expect(sendEmail({ to: "t@example.com", subject: "S", text: "T" })).rejects.toThrow(
            "Resend email failed with HTTP 403: Domain not verified",
        );
    });

    it("names the missing env keys without calling Resend", async () => {
        vi.stubEnv("RESEND_API_KEY", "");

        await expect(sendEmail({ to: "t@example.com", subject: "S", text: "T" })).rejects.toThrow(
            "missing RESEND_API_KEY",
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
