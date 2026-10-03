/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideSignals, SIGNAL_FLAG_LINE } from "@/collection/signals";

const CALM = { hardship: 0.05, dispute: 0.05, distressed: 0.05 };

describe("decideSignals", () => {
    beforeEach(() => {
        vi.stubEnv("SCAMLORD_PLAYBOOK_MODE", "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("continues with no reasons when every probability is below the flag line", () => {
        expect(decideSignals(CALM)).toEqual({ decision: "continue", reasons: [] });
    });

    it("uses 0.35 as the flag line", () => {
        expect(SIGNAL_FLAG_LINE).toBe(0.35);
    });

    it.each(["hardship", "dispute", "distressed"] as const)(
        "continues when %s is just below the line",
        (key) => {
            expect(decideSignals({ ...CALM, [key]: 0.3499 })).toEqual({
                decision: "continue",
                reasons: [],
            });
        },
    );

    it.each(["hardship", "dispute", "distressed"] as const)(
        "hands off when %s is exactly at the line (inclusive)",
        (key) => {
            expect(decideSignals({ ...CALM, [key]: 0.35 })).toEqual({
                decision: "handoff",
                reasons: [key],
            });
        },
    );

    it.each(["hardship", "dispute", "distressed"] as const)(
        "hands off when %s is above the line",
        (key) => {
            expect(decideSignals({ ...CALM, [key]: 0.9 })).toEqual({
                decision: "handoff",
                reasons: [key],
            });
        },
    );

    it("lists every flagged reason in hardship, dispute, distressed order", () => {
        expect(decideSignals({ hardship: 0.8, dispute: 0.1, distressed: 0.5 })).toEqual({
            decision: "handoff",
            reasons: ["hardship", "distressed"],
        });
        expect(decideSignals({ hardship: 1, dispute: 1, distressed: 1 })).toEqual({
            decision: "handoff",
            reasons: ["hardship", "dispute", "distressed"],
        });
    });
});

describe("decideSignals in playbook mode", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("keeps negotiating with a playbook script instead of handing off", () => {
        vi.stubEnv("SCAMLORD_PLAYBOOK_MODE", "1");
        expect(decideSignals({ ...CALM, hardship: 0.9 })).toEqual({
            decision: "continue",
            reasons: ["hardship"],
            playbook: "hardship",
        });
    });
});
