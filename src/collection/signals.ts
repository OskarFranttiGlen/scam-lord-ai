/**
 * @module collection/signals
 *
 * Applies the 0.35 flag line to Jev hardship, dispute, and distress probabilities.
 *
 * Depends on: ./types
 * Used by: jev, collection tools
 */

import type { TSignalDecision, TJevPlaybook, TJevSignalProbabilities } from "./types";

/** Any question at or above this probability routes to a human. */
export const SIGNAL_FLAG_LINE = 0.35;

/** When true, Jev flags pick a playbook script instead of handing off (see docs/SPEC.md). */
export function isPlaybookMode(): boolean {
    const value = process.env.SCAMLORD_PLAYBOOK_MODE?.trim().toLowerCase();
    return value === "1" || value === "true";
}

/**
 * Primary playbook when several Jev questions flag at once.
 *
 * @param reasons - Flagged reasons in detection order
 */
function primaryPlaybook(reasons: TJevPlaybook[]): TJevPlaybook | undefined {
    if (reasons.includes("distressed")) {
        return "distressed";
    }
    if (reasons.includes("hardship")) {
        return "hardship";
    }
    if (reasons.includes("dispute")) {
        return "dispute";
    }
    return undefined;
}

/**
 * Maps Jev probabilities to continue vs handoff and reason codes.
 *
 * @param probabilities - hardship, dispute, and distressed probabilities in [0, 1]
 */
export function decideSignals(probabilities: TJevSignalProbabilities): TSignalDecision {
    const reasons: TJevPlaybook[] = [];

    if (probabilities.hardship >= SIGNAL_FLAG_LINE) {
        reasons.push("hardship");
    }
    if (probabilities.dispute >= SIGNAL_FLAG_LINE) {
        reasons.push("dispute");
    }
    if (probabilities.distressed >= SIGNAL_FLAG_LINE) {
        reasons.push("distressed");
    }

    if (!reasons.length) {
        return { decision: "continue", reasons: [] };
    }
    if (isPlaybookMode()) {
        return { decision: "continue", reasons, playbook: primaryPlaybook(reasons) };
    }
    return { decision: "handoff", reasons };
}
