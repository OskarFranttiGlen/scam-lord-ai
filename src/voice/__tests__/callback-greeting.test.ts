import { describe, expect, it } from "vitest";

import { getDemoCallContext } from "@/voice/demo-context";
import { buildCallbackGreeting, buildCallbackHistory } from "@/voice/livekit-agent";
import { UNKNOWN_CALLER_GREETING } from "@/voice/unknown-caller";

const MONEY_WORDS = /dollar|balance of|\$|\d|owe|invoice/i;

describe("callback greetings", () => {
    const context = { ...getDemoCallContext(), tenantName: "Jordan Lee", propertyName: "Maple Court" };

    it("greets a known caller by first name and introduces Mia from the manager", () => {
        const greeting = buildCallbackGreeting(context, { handoffActive: false });

        expect(greeting).toBe(
            "Hi Jordan, it's Mia from Maple Court Property Management. How can I help today?",
        );
    });

    it("tells a handed-off caller a person will follow up and offers to take a message", () => {
        const greeting = buildCallbackGreeting(context, { handoffActive: true });

        expect(greeting).toContain("Hi Jordan");
        expect(greeting).toContain("it's Mia from");
        expect(greeting).toMatch(/follow up/);
        expect(greeting).toMatch(/take a message/);
        expect(greeting).not.toMatch(MONEY_WORDS);
    });

    it("gives an unknown caller no account details", () => {
        expect(UNKNOWN_CALLER_GREETING).toContain("Mia, an AI assistant");
        expect(UNKNOWN_CALLER_GREETING).toMatch(/your name/);
        expect(UNKNOWN_CALLER_GREETING).toMatch(/call you back/);
        expect(UNKNOWN_CALLER_GREETING).not.toMatch(MONEY_WORDS);
        expect(UNKNOWN_CALLER_GREETING).not.toMatch(/Jordan|Maple/);
    });
});

describe("buildCallbackHistory", () => {
    it("puts the prior conversation before the greeting as context the tenant did not say", () => {
        const history = buildCallbackHistory("Previous conversation: ...\nTenant: I lost my job.", "Hi Jordan.");

        expect(history).toHaveLength(2);
        expect(history[0].role).toBe("user");
        expect(String(history[0].content)).toContain("Tenant: I lost my job.");
        expect(String(history[0].content)).toMatch(/not said on this call/i);
        expect(history[1]).toEqual({ role: "assistant", content: "Hi Jordan." });
    });

    it("is just the greeting when there is no earlier conversation", () => {
        expect(buildCallbackHistory(null, "Hi Jordan.")).toEqual([{ role: "assistant", content: "Hi Jordan." }]);
    });
});
