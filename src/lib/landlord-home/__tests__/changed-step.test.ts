/**
 * Which step flashes after a calls refetch (ADR 0001 / 06).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { changedStep } from "../changed-step";

describe("changedStep", () => {
    it("does not flash the first load or a new call", () => {
        expect(changedStep([], [{ id: "a", currentStep: "disclosure" }])).toBeNull();
        expect(changedStep(
            [{ id: "a", currentStep: "disclosure" }],
            [
                { id: "a", currentStep: "disclosure" },
                { id: "b", currentStep: "invoice" },
            ],
        )).toBeNull();
    });

    it("flashes the step that changed, preferring the earlier row", () => {
        expect(changedStep(
            [
                { id: "a", currentStep: "disclosure" },
                { id: "b", currentStep: "plan" },
            ],
            [
                { id: "a", currentStep: "payment_link" },
                { id: "b", currentStep: "paid" },
            ],
        )).toEqual({ id: "a", step: "payment_link" });
    });

    it("does not flash when the step is unchanged", () => {
        const agents = [{ id: "a", currentStep: "jev" }];
        expect(changedStep(agents, agents)).toBeNull();
    });
});
