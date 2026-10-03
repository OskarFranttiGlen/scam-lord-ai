/**
 * @module chat/questionnaire-gate/select
 *
 * Picks Questionnaire gate questions (ADR 0023 app-owns-list, ADR 0034 / C10).
 * Domain-neutral stubs only — no training-profile / program-format / days-per-week logic.
 *
 * Depends on: ./catalog
 * Used by: getMoreInfoQuestions tool
 */

import { sampleQuestions } from "./catalog";

/** Open reasons after the fitness strip. `none` = empty catalog / gate not needed. */
export type TQuestionnaireGateReason = "clarify" | "none";

/** Submit continues the chat turn; answers ride on the next body (no profile write). */
export type TQuestionnaireGateCompleteAction = "continue";

export type TQuestionnaireGateSelection = {
    reason: TQuestionnaireGateReason;
    questions: TQuestion[];
    allowSkip: boolean;
    completeAction: TQuestionnaireGateCompleteAction;
    initialAnswers: Record<string, string | string[]>;
};

export type TSelectQuestionnaireGateInput = {
    /** Latest user text (tool `userRequest` or the chat message). Unused by stubs; kept for extenders. */
    userRequest?: string | null;
    /** Prefill answers keyed by question id (session / prior submit). */
    initialAnswers?: Record<string, string | string[]> | null;
};

function emptySelection(): TQuestionnaireGateSelection {
    return {
        reason: "none",
        questions: [],
        allowSkip: false,
        completeAction: "continue",
        initialAnswers: {},
    };
}

/**
 * Returns the app-owned stub catalog when the agent opens the gate.
 * Does not force open from missing fitness fields — call sites only run this
 * when `getMoreInfoQuestions` is invoked.
 *
 * @param input.userRequest - Optional request text (reserved for extenders)
 * @param input.initialAnswers - Optional prefill map
 */
export function selectQuestionnaireGateQuestions(
    input: TSelectQuestionnaireGateInput = {},
): TQuestionnaireGateSelection {
    if (sampleQuestions.length === 0) {
        return emptySelection();
    }

    return {
        reason: "clarify",
        questions: sampleQuestions,
        allowSkip: true,
        completeAction: "continue",
        initialAnswers: { ...(input.initialAnswers ?? {}) },
    };
}
