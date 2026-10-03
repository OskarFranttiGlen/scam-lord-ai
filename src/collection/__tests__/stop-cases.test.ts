import { describe, expect, it } from "vitest";

import { detectStopCase, isPersonRequest } from "../stop-cases";

describe("detectStopCase", () => {
    it("flags safety language", () => {
        expect(detectStopCase("I might hurt myself")?.case).toBe("safety");
    });

    it("flags legal matters", () => {
        expect(detectStopCase("I've talked to a lawyer")?.case).toBe("legal");
    });

    it("flags protected circumstances", () => {
        expect(detectStopCase("I'm dealing with domestic violence")?.case).toBe("protected");
    });

    it("flags repair escalation to officials", () => {
        expect(detectStopCase("I'm calling the city inspector")?.case).toBe("repair_escalation");
    });

    it("ignores normal rent talk", () => {
        expect(detectStopCase("Can I pay half on Friday?")).toBeNull();
    });
});

describe("isPersonRequest", () => {
    it("detects a request for a person", () => {
        expect(isPersonRequest("I want to talk to a real person")).toBe(true);
    });
});
