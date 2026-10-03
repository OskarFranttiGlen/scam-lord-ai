/**
 * @module collection/stop-cases
 *
 * Five cases where a person must take over the call (RentRecovery scenario playbook,
 * Oct 2026). Matched on the latest tenant line only, case-insensitive.
 *
 * Depends on: none
 * Used by: @/collection/signals.ts, @/voice/run-turn.ts
 */

export type TStopCase = "safety" | "legal" | "protected" | "person_requested" | "repair_escalation";

export type TStopDetection = {
    case: TStopCase;
    /** Stored on `calls.handoff_reason` where it maps cleanly. */
    handoffReason: "distressed" | "dispute" | "hardship" | "urgent_maintenance";
};

const SAFETY = /\b(988|kill myself|hurt myself|end my life|suicide|self[- ]?harm)\b/i;
const LEGAL = /\b(lawyer|attorney|eviction notice|court papers|bankruptcy|filed for bankruptcy)\b/i;
const PROTECTED = /\b(domestic violence|military deployment|deployed overseas)\b/i;
const REPAIR_ESCALATION = /\b(lawyer|inspector|city inspector|housing inspector|code enforcement)\b/i;

/**
 * Returns a stop case when the tenant's latest line requires a person, else null.
 *
 * @param latestTenantLine - Most recent tenant utterance (not the full transcript)
 */
export function detectStopCase(latestTenantLine: string): TStopDetection | null {
    const text = latestTenantLine.trim();
    if (!text) {
        return null;
    }
    if (SAFETY.test(text)) {
        return { case: "safety", handoffReason: "distressed" };
    }
    if (LEGAL.test(text)) {
        return { case: "legal", handoffReason: "dispute" };
    }
    if (PROTECTED.test(text)) {
        return { case: "protected", handoffReason: "hardship" };
    }
    if (REPAIR_ESCALATION.test(text)) {
        return { case: "repair_escalation", handoffReason: "urgent_maintenance" };
    }
    return null;
}

/**
 * True when the tenant is asking for a human on this line (first ask vs second is tracked in call state).
 *
 * @param latestTenantLine - Most recent tenant utterance
 */
export function isPersonRequest(latestTenantLine: string): boolean {
    return /\b(real person|talk to a person|human being|speak to someone|actual person|not a robot)\b/i.test(latestTenantLine);
}
