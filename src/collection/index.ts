/**
 * @module collection
 *
 * ScamLord rent collection policy enforcement and Jev signal gate.
 *
 * Depends on: ./policy, ./signals, ./jev, ./types
 * Used by: voice agent tools, WorkflowAgent
 */

export { checkPolicy, type TCheckPolicyContext } from "./policy";
export { decideSignals, SIGNAL_FLAG_LINE } from "./signals";
export {
    evaluateSignals,
    evaluateSignalsViaGateway,
    evaluateSignalsWithClaudeFallback,
    JEV_MODEL,
    JEV_SIGNAL_QUESTIONS,
} from "./jev";
export type {
    TJevCheckRecord,
    TPaymentInstallment,
    TPaymentPlan,
    TPerk,
    TPolicy,
    TPolicyResult,
    TSignalDecision,
    TEvaluateSignalsInput,
    TEvaluateSignalsResult,
    TJevBooleanQuestion,
    TJevPolicyConstraints,
    TJevSignalProbabilities,
    TJevSignalQuestions,
    TPerkCondition,
} from "./types";
