/**
 * @module collection/apply-signals
 *
 * Turns Jev output and the latest tenant line into call-state updates: playbook scripts,
 * stop cases, and person-request counting (scenario playbook, Oct 2026).
 *
 * Depends on: ./stop-cases, ./types, @/voice/context
 * Used by: @/voice/run-turn.ts
 */

import type { CallState } from "@/voice/context";

import { detectStopCase, isPersonRequest, type TStopCase } from "./stop-cases";
import type { TSignalDecision } from "./types";

const STOP_CASES = new Set<TStopCase>([
    "safety",
    "legal",
    "protected",
    "person_requested",
    "repair_escalation",
]);

/**
 * @param value - Raw stop case from JSON
 */
export function parseStopCase(value: unknown): TStopCase | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    return STOP_CASES.has(value as TStopCase) ? value as TStopCase : undefined;
}

/**
 * Stop cases and person requests are checked on every tenant line before Jev runs.
 *
 * @param state - Mutable call state
 * @param latestTenantLine - Text of the turn just spoken
 */
export function applyStopAndPerson(state: CallState, latestTenantLine: string): void {
    const stop = detectStopCase(latestTenantLine);
    if (stop) {
        state.handoffActive = true;
        state.stopCase = stop.case;
        state.jevPlaybook = undefined;
        return;
    }
    if (isPersonRequest(latestTenantLine)) {
        state.personRequestCount += 1;
        if (state.personRequestCount >= 2) {
            state.handoffActive = true;
            state.stopCase = "person_requested";
            state.jevPlaybook = undefined;
        }
    }
}

/**
 * Applies Jev's decision when the call is still in negotiation.
 *
 * @param state - Mutable call state
 * @param signal - Jev decision for this turn
 */
export function applyJevOutcome(state: CallState, signal: TSignalDecision): void {
    if (state.handoffActive) {
        return;
    }
    if (signal.decision === "handoff") {
        state.handoffActive = true;
        state.jevPlaybook = undefined;
        return;
    }
    if (signal.playbook) {
        state.jevPlaybook = signal.playbook;
    }
}
