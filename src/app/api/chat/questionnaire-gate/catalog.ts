/**
 * @module chat/questionnaire-gate/catalog
 *
 * Domain-neutral Questionnaire gate stubs (ADR 0034 / C10).
 * App-owned list (ADR 0023) — the agent must not invent extras.
 *
 * Depends on: none (ambient TQuestion)
 * Used by: select.ts, selection tests
 */

/** Stub question ids kept in the default template. */
export const QUESTIONNAIRE_STUB_IDS = ["artifact-title", "audience"] as const;

export type TQuestionnaireStubId = (typeof QUESTIONNAIRE_STUB_IDS)[number];

/**
 * Tiny clarify catalog for extenders and rare agent clarify turns.
 * Not forced open by the default prompt.
 */
export const sampleQuestions: TQuestion[] = [
    {
        id: "artifact-title",
        question: "What should we call this artifact?",
        type: "text-with-quickfill",
        options: [
            { id: "draft", label: "Draft" },
            { id: "plan", label: "Plan" },
            { id: "outline", label: "Outline" },
        ],
        allowOther: true,
        section: "core",
    },
    {
        id: "audience",
        question: "Who is this for?",
        type: "select",
        options: [
            { id: "myself", label: "Myself" },
            { id: "team", label: "A team" },
            { id: "clients", label: "Clients" },
        ],
        allowOther: true,
        section: "core",
    },
];
