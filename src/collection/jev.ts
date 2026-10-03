/**
 * @module collection/jev
 *
 * Jev signal evaluation via AI Gateway and optional Claude JSON fallback.
 *
 * Depends on: ai, zod, ./signals, ./types
 * Used by: @/voice/run-turn.ts (evaluated concurrently with each voice turn)
 */

import { experimental_evaluate as evaluate, generateObject } from "ai";
import { z } from "zod";

import { decideSignals } from "./signals";
import type {
    TJevCheckRecord,
    TSignalDecision,
    TEvaluateSignalsInput,
    TEvaluateSignalsResult,
    TJevSignalProbabilities,
    TJevSignalQuestions,
} from "./types";

export const JEV_MODEL = "typesafe-ai/jev";

/** Pre-defined boolean questions from docs/safeguards.md */
export const JEV_SIGNAL_QUESTIONS: TJevSignalQuestions = {
    hardship: {
        type: "boolean",
        instructions: "Is the tenant describing hardship that should go to a human?",
        criteria: {
            true: "Job loss, illness, family emergency, or inability to pay that needs a person.",
            false: "Ordinary scheduling, a question, or a normal payment plan.",
        },
    },
    dispute: {
        type: "boolean",
        instructions: "Is the tenant disputing the charge, the ledger, or that they owe this amount?",
        criteria: {
            true: "They say the balance is wrong, rent was already paid, or a repair makes the charge unfair.",
            false: "They accept the balance, are only discussing how to pay, or are just asking who is calling "
                + "or whether the call is legitimate.",
        },
    },
    distressed: {
        type: "boolean",
        instructions: "Does the tenant sound distressed or overwhelmed enough that negotiation should stop?",
        criteria: {
            true: "Panic, crying, fear, or language that continuing the collection call would be inappropriate.",
            false: "Calm, frustrated, or businesslike.",
        },
    },
};

const claudeProbabilitySchema = z.object({
    hardship: z.number().min(0).max(1),
    dispute: z.number().min(0).max(1),
    distressed: z.number().min(0).max(1),
});

const LOW_SIGNAL_PROBABILITIES: TJevSignalProbabilities = {
    hardship: 0.05,
    dispute: 0.05,
    distressed: 0.05,
};

function buildJevState(input: TEvaluateSignalsInput): Record<string, unknown> {
    return {
        transcript: input.transcript,
        ...(input.photoSummary ? { photo_summary: input.photoSummary } : {}),
        ...(input.maintenanceSummary ? { maintenance_history: input.maintenanceSummary } : {}),
        constraints: input.constraints,
    };
}

function buildRecord(
    input: TEvaluateSignalsInput,
    probabilities: TJevSignalProbabilities,
    outcome: TSignalDecision,
    model: string,
): TJevCheckRecord {
    return {
        transcript: input.transcript,
        photoSummary: input.photoSummary ?? null,
        constraints: input.constraints,
        questions: JEV_SIGNAL_QUESTIONS,
        probabilities,
        outcome: { decision: outcome.decision, reasons: outcome.reasons },
        evaluatedAt: new Date().toISOString(),
        model,
    };
}

function booleanProbability(
    answer: Awaited<ReturnType<typeof evaluate>>["answers"][string],
): number {
    if (answer.type === "boolean") {
        return answer.probability;
    }
    return 0;
}

function extractProbabilities(
    answers: Awaited<ReturnType<typeof evaluate>>["answers"],
): TJevSignalProbabilities {
    return {
        hardship: booleanProbability(answers.hardship),
        dispute: booleanProbability(answers.dispute),
        distressed: booleanProbability(answers.distressed),
    };
}

/**
 * Evaluates hardship, dispute, and distress via Jev on AI Gateway (zero data retention).
 *
 * @param input - Transcript, optional photo summary, and policy constraints for state
 */
export async function evaluateSignalsViaGateway(
    input: TEvaluateSignalsInput,
): Promise<TEvaluateSignalsResult> {
    const result = await evaluate({
        model: JEV_MODEL,
        state: buildJevState(input),
        questions: JEV_SIGNAL_QUESTIONS,
        providerOptions: {
            gateway: { zeroDataRetention: true },
        },
    } as Parameters<typeof evaluate>[0]);

    const probabilities = extractProbabilities(result.answers);
    const signal = decideSignals(probabilities);
    const record = buildRecord(input, probabilities, signal, JEV_MODEL);

    return {
        probabilities,
        record,
        ...signal,
    };
}

/**
 * When `SCAMLORD_JEV_CLAUDE_FALLBACK=true`, asks Claude for the same three probabilities;
 * otherwise returns low probabilities so negotiation can continue without Gateway.
 *
 * @param input - Same state as Gateway evaluation
 */
export async function evaluateSignalsWithClaudeFallback(
    input: TEvaluateSignalsInput,
): Promise<TEvaluateSignalsResult> {
    const useClaude = process.env.SCAMLORD_JEV_CLAUDE_FALLBACK === "true";

    if (useClaude) {
        const { object } = await generateObject({
            model: "anthropic/claude-haiku-4-5",
            schema: claudeProbabilitySchema,
            prompt: `Estimate the probability (0 to 1) that each statement is TRUE about this rent collection call.

Transcript:
${input.transcript}
${input.photoSummary ? `\nPhoto summary:\n${input.photoSummary}` : ""}
${input.maintenanceSummary ? `\nMaintenance history:\n${input.maintenanceSummary}` : ""}

Policy constraints: ${JSON.stringify(input.constraints)}

Questions:
1. hardship — ${JEV_SIGNAL_QUESTIONS.hardship.instructions}
   True if: ${JEV_SIGNAL_QUESTIONS.hardship.criteria.true}
   False if: ${JEV_SIGNAL_QUESTIONS.hardship.criteria.false}
2. dispute — ${JEV_SIGNAL_QUESTIONS.dispute.instructions}
   True if: ${JEV_SIGNAL_QUESTIONS.dispute.criteria.true}
   False if: ${JEV_SIGNAL_QUESTIONS.dispute.criteria.false}
3. distressed — ${JEV_SIGNAL_QUESTIONS.distressed.instructions}
   True if: ${JEV_SIGNAL_QUESTIONS.distressed.criteria.true}
   False if: ${JEV_SIGNAL_QUESTIONS.distressed.criteria.false}

Return JSON with hardship, dispute, and distressed as numbers from 0 to 1.`,
        });

        const probabilities: TJevSignalProbabilities = {
            hardship: object.hardship,
            dispute: object.dispute,
            distressed: object.distressed,
        };
        const signal = decideSignals(probabilities);
        const record = buildRecord(input, probabilities, signal, "anthropic/claude-haiku-4-5-fallback");

        return {
            probabilities,
            record,
            ...signal,
        };
    }

    const probabilities = { ...LOW_SIGNAL_PROBABILITIES };
    const signal = decideSignals(probabilities);
    const record = buildRecord(input, probabilities, signal, "stub-low-probability");

    return {
        probabilities,
        record,
        ...signal,
    };
}

/**
 * Default signal evaluation for voice turns (Claude fallback / low-probability stub).
 *
 * @param input - Transcript and policy constraints for Jev state
 */
export async function evaluateSignals(
    input: TEvaluateSignalsInput,
): Promise<TEvaluateSignalsResult> {
    if (process.env.AI_GATEWAY_API_KEY?.trim()) {
        try {
            return await evaluateSignalsViaGateway(input);
        } catch (error) {
            console.warn("[collection/jev] Gateway evaluate failed, using fallback:", error);
        }
    }
    return evaluateSignalsWithClaudeFallback(input);
}
