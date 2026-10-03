/**
 * Tools always kept when a skill sets `allowedTools` (route prepareCall).
 * C2 companions: sandbox trio + Questionnaire gate.
 * getMoreInfoQuestions must survive so an optional clarify turn can still open
 * the gate after mutate-artifact is loaded. readArtifact / mutateArtifact come
 * from the skill allowlist (not always-available).
 */
export const ALWAYS_AVAILABLE_CHAT_TOOLS = [
    "loadSkill",
    "readFile",
    "bash",
    "getMoreInfoQuestions",
] as const;
