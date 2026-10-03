/**
 * @module collection/types
 *
 * Landlord policy, payment plans, and Jev signal check shapes for ScamLord collection.
 *
 * Depends on: none
 * Used by: policy, signals, jev, collection index
 */

/** Landlord collection limits from the dashboard (one row per landlord). */
export type TPolicy = {
    maxInstallments: number;
    graceDays: number;
    feeWaiverCap: number;
};

/** Unlock condition for a landlord-written perk. */
export type TPerkCondition = {
    type: "pay_in_full_today";
};

/** Landlord perk: spoken copy plus when it may be offered. */
export type TPerk = {
    id: string;
    text: string;
    condition: TPerkCondition;
};

export type TPaymentInstallment = {
    /** Calendar date YYYY-MM-DD */
    date: string;
    amount: number;
};

/** Negotiated schedule: splits, optional fee waiver, at most one perk. */
export type TPaymentPlan = {
    installments: TPaymentInstallment[];
    feeWaiver: number;
    perkId?: string | null;
};

export type TPolicyResult = {
    status: "accepted" | "counter";
    plan: TPaymentPlan;
    /** Plain language Claude may speak; no ids or tool names. */
    message: string;
};

export type TJevPlaybook = "hardship" | "dispute" | "distressed";

export type TSignalDecision = {
    decision: "continue" | "handoff";
    reasons: TJevPlaybook[];
    /** When playbook mode is on, Jev flagged but the agent keeps negotiating on this script. */
    playbook?: TJevPlaybook;
};

export type TJevSignalProbabilities = {
    hardship: number;
    dispute: number;
    distressed: number;
};

/** Policy limits included in Jev state (snake_case matches gateway payload). */
export type TJevPolicyConstraints = {
    max_installments: number;
    grace_days: number;
    fee_waiver_cap: number;
};

export type TJevBooleanQuestion = {
    type: "boolean";
    instructions: string;
    criteria: {
        true: string;
        false: string;
    };
};

export type TJevSignalQuestions = {
    hardship: TJevBooleanQuestion;
    dispute: TJevBooleanQuestion;
    distressed: TJevBooleanQuestion;
};

/** Stored trace for each turn’s signal check (dashboard + calibration). */
export type TJevCheckRecord = {
    transcript: string;
    photoSummary: string | null;
    constraints: TJevPolicyConstraints;
    questions: TJevSignalQuestions;
    probabilities: TJevSignalProbabilities;
    outcome: TSignalDecision;
    evaluatedAt: string;
    model: string;
};

export type TEvaluateSignalsInput = {
    transcript: string;
    photoSummary?: string | null;
    /** The tenancy's repair history, so a charge disputed over an unfixed repair reads as a dispute. */
    maintenanceSummary?: string | null;
    constraints: TJevPolicyConstraints;
};

export type TEvaluateSignalsResult = {
    probabilities: TJevSignalProbabilities;
    record: TJevCheckRecord;
} & TSignalDecision;
