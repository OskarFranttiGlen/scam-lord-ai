/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
    QUESTIONNAIRE_STUB_IDS,
    sampleQuestions,
} from "../catalog";
import { selectQuestionnaireGateQuestions } from "../select";

describe("questionnaire stub catalog (C10)", () => {
    it("exposes only domain-neutral stub ids", () => {
        expect(sampleQuestions.map((q) => q.id)).toEqual([...QUESTIONNAIRE_STUB_IDS]);
        expect(QUESTIONNAIRE_STUB_IDS).toEqual(["artifact-title", "audience"]);
        for (const id of sampleQuestions.map((q) => q.id)) {
            expect(id).not.toMatch(/days-per-week|training|constraint|program-length|exclude-/);
        }
    });
});

describe("selectQuestionnaireGateQuestions", () => {
    it("returns clarify stubs when the catalog is non-empty", () => {
        const selected = selectQuestionnaireGateQuestions({
            userRequest: "help me plan this",
        });
        expect(selected.reason).toBe("clarify");
        expect(selected.questions.map((q) => q.id)).toEqual([
            "artifact-title",
            "audience",
        ]);
        expect(selected.allowSkip).toBe(true);
        expect(selected.completeAction).toBe("continue");
    });

    it("passes through initialAnswers without fitness profile detection", () => {
        const selected = selectQuestionnaireGateQuestions({
            userRequest: "update my profile",
            initialAnswers: { "artifact-title": "Launch outline" },
        });
        expect(selected.reason).toBe("clarify");
        expect(selected.initialAnswers).toEqual({
            "artifact-title": "Launch outline",
        });
        expect(selected.questions.every((q) => q.id !== "days-per-week")).toBe(true);
    });
});
