/**
 * Tool-turn fast path: tools whose result carries a `say` line end the loop after the tool
 * step, so the turn speaks that line with a single model call; `next`-only tools keep the
 * second, model-phrased pass.
 */
import type { ModelMessage } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateSignals, JEV_SIGNAL_QUESTIONS } from "@/collection/jev";
import type { TEvaluateSignalsResult, TSignalDecision } from "@/collection/types";
import { createCollectionVoiceAgent } from "../agent";
import { createInitialCallState, getDemoCallContext } from "../context";
import { runVoiceTurn } from "../run-turn";
import { getCollectionTools } from "../tools";

vi.mock("@/collection/jev", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/collection/jev")>()),
    evaluateSignals: vi.fn(),
}));

const CONSTRAINTS = { max_installments: 2, grace_days: 14, fee_waiver_cap: 50 };

function signals(decision: TSignalDecision["decision"]): TEvaluateSignalsResult {
    const outcome: TSignalDecision = { decision, reasons: decision === "handoff" ? ["hardship"] : [] };
    const probabilities = { hardship: decision === "handoff" ? 0.9 : 0.05, dispute: 0.05, distressed: 0.05 };
    return {
        ...outcome,
        probabilities,
        record: {
            transcript: "",
            photoSummary: null,
            constraints: CONSTRAINTS,
            questions: JEV_SIGNAL_QUESTIONS,
            probabilities,
            outcome,
            evaluatedAt: "2026-10-03T00:00:00.000Z",
            model: "test",
        },
    };
}

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };
const GREETING: ModelMessage[] = [{ role: "assistant", content: "Hi, this is an AI assistant." }];

function usage() {
    return {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
    };
}

/** Mock model result that calls `toolName` with `input`, then a plain text result. */
function toolCallResult(toolName: string, input: unknown) {
    return {
        content: [{
            type: "tool-call" as const,
            toolCallId: "call_1",
            toolName,
            input: JSON.stringify(input),
        }],
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
        usage: usage(),
        warnings: [],
    };
}

function textResult(text: string) {
    return {
        content: [{ type: "text" as const, text }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: usage(),
        warnings: [],
    };
}

describe("collection agent tool-turn fast path", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T18:00:00Z"));
        vi.mocked(evaluateSignals).mockReset();
        vi.mocked(evaluateSignals).mockResolvedValue(signals("continue"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("speaks the check_policy say after a single model call", async () => {
        const state = createInitialCallState();
        const model = new MockLanguageModelV3({
            doGenerate: toolCallResult("check_policy", {
                installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-12", amount: 920 }],
            }),
        });
        const agent = createCollectionVoiceAgent({ context: getDemoCallContext(), state, model });

        const result = await runVoiceTurn({
            agent,
            userText: "half today and half on October twelfth?",
            messages: GREETING,
            state,
        });

        expect(model.doGenerateCalls).toHaveLength(1);
        expect(result.assistantText).toBe(
            "That works: nine hundred twenty dollars today and nine hundred twenty dollars on Monday, "
            + "October twelfth. Shall I set it up?",
        );
        expect(result.messages.at(-1)).toEqual({ role: "assistant", content: result.assistantText });
        expect(state.transcriptLines.at(-1)).toBe(`Agent: ${result.assistantText}`);
    });

    it("still makes a second model call after record_feedback", async () => {
        const state = createInitialCallState();
        const model = new MockLanguageModelV3({
            doGenerate: [
                toolCallResult("record_feedback", { summary: "All good", declined: false, issues: [] }),
                textResult("Thanks for sharing that."),
            ],
        });
        const agent = createCollectionVoiceAgent({ context: getDemoCallContext(), state, model });

        const result = await runVoiceTurn({ agent, userText: "all good here", messages: GREETING, state });

        expect(model.doGenerateCalls).toHaveLength(2);
        expect(result.assistantText).toContain("Thanks for sharing that.");
    });
});

describe("fast-path say lines", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T18:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("ends the accepted plan say with the setup question", async () => {
        const tools = getCollectionTools(getDemoCallContext(), createInitialCallState());

        const result = await tools.check_policy.execute?.(
            { installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-12", amount: 920 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({
            status: "accepted",
            say: "That works: nine hundred twenty dollars today and nine hundred twenty dollars on Monday, "
                + "October twelfth. Shall I set it up?",
        });
    });

    it("offers the counter plan as a question", async () => {
        const tools = getCollectionTools(getDemoCallContext(), createInitialCallState());

        const result = await tools.check_policy.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1000 }, { date: "2026-10-09", amount: 1000 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({
            status: "counter",
            say: "The installments need to add up to eighteen hundred forty dollars. I can do nine hundred "
                + "twenty dollars today and nine hundred twenty dollars on Monday, October twelfth. Does that work?",
        });
    });

    it("speaks the check-in gate to the tenant instead of instructing the model", async () => {
        const tools = getCollectionTools(getDemoCallContext(), createInitialCallState(), { channel: "text" });

        const result = await tools.check_policy.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1840 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({
            status: "check_in_first",
            say: expect.stringMatching(/how are things going with the unit\?/i),
        });
    });

    it("speaks the missed-promises lockout to the tenant", async () => {
        const context = {
            ...getDemoCallContext(),
            followUp: {
                notes: [],
                brokenPromises: [
                    { date: "2026-09-20", amount: null },
                    { date: "2026-09-25", amount: null },
                ],
            },
        };
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        const tools = getCollectionTools(context, state, { channel: "text" });

        const result = await tools.check_policy.execute?.(
            { installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-12", amount: 920 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({
            status: "plan_not_available",
            say: expect.stringMatching(/full balance/i),
        });
    });

    it("returns a speakable say from confirm_payment", async () => {
        const tools = getCollectionTools(getDemoCallContext(), createInitialCallState());

        const result = await tools.confirm_payment.execute?.({}, TOOL_OPTIONS);

        expect(result).toMatchObject({
            status: "pending",
            say: expect.stringContaining("pending"),
        });
    });
});