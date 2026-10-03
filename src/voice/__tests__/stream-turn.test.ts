import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateSignals, JEV_SIGNAL_QUESTIONS } from "@/collection/jev";
import type { TEvaluateSignalsResult, TSignalDecision } from "@/collection/types";
import { createInitialCallState } from "../context";
import { toSpokenText } from "../instructions";
import {
    POLICY_CHECK_FILLER,
    streamVoiceTurn,
    type TBrainStreamPart,
    type TStreamingVoiceBrain,
} from "../run-turn";

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

type TFakeStep = { text: string; toolCalls: unknown[]; toolResults: { output: unknown }[] };

type TFakeRun = {
    parts: Array<TBrainStreamPart | Promise<void>>;
    steps?: TFakeStep[];
    responseMessages?: ModelMessage[];
};

/**
 * Brain whose `stream` replays scripted parts; a Promise in `parts` pauses the stream until it resolves.
 *
 * @param runs - One scripted run per `stream` call, in order
 */
function fakeBrain(runs: TFakeRun[]): TStreamingVoiceBrain & { calls: Array<AbortSignal | undefined> } {
    const calls: Array<AbortSignal | undefined> = [];
    return {
        calls,
        signalGate: { pending: null },
        signalConstraints: CONSTRAINTS,
        signalMaintenanceSummary: "Kitchen tap dripping: open, reported 2026-09-21",
        disclosureLine: "Hi, I'm an AI assistant calling for Maple Court.",
        formatReply: toSpokenText,
        async stream({ abortSignal }) {
            const run = runs[calls.length];
            calls.push(abortSignal);
            async function* fullStream(): AsyncGenerator<TBrainStreamPart> {
                for (const part of run.parts) {
                    if (part instanceof Promise) {
                        await part;
                    } else {
                        if (abortSignal?.aborted) {
                            return;
                        }
                        yield part;
                    }
                }
            }
            return {
                fullStream: fullStream(),
                steps: Promise.resolve(run.steps ?? []),
                response: Promise.resolve({ messages: run.responseMessages ?? [] }),
            };
        },
    };
}

function text(value: string): TBrainStreamPart {
    return { type: "text-delta", text: value };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
    const chunks: string[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return chunks;
}

const GREETING: ModelMessage[] = [{ role: "assistant", content: "Hi, this is an AI assistant." }];

describe("streamVoiceTurn", () => {
    beforeEach(() => {
        vi.mocked(evaluateSignals).mockReset();
        vi.mocked(evaluateSignals).mockResolvedValue(signals("continue"));
    });

    it("emits the first sentence before the model finishes the reply", async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const brain = fakeBrain([{ parts: [text("Your balance is "), text("$1,840. "), gate, text("Want a plan?")] }]);

        const turn = streamVoiceTurn({ agent: brain, userText: "how much?", messages: GREETING, state: createInitialCallState() });
        const iterator = turn.textStream[Symbol.asyncIterator]();
        const first = await iterator.next();

        expect(first.value).toBe("Your balance is eighteen hundred forty dollars. ");
        release();
        const rest: string[] = [];
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            rest.push(next.value);
        }
        expect(rest.join("")).toBe("Want a plan?");
        expect((await turn.result).assistantText).toBe("Your balance is eighteen hundred forty dollars. Want a plan?");
    });

    it("says a filler line as soon as check_policy starts when nothing has been said yet", async () => {
        const brain = fakeBrain([{
            parts: [{ type: "tool-input-start", toolName: "check_policy" }, text("That works.")],
        }]);

        const chunks = await collect(
            streamVoiceTurn({ agent: brain, userText: "half friday?", messages: GREETING, state: createInitialCallState() }).textStream,
        );

        expect(chunks[0]).toBe(`${POLICY_CHECK_FILLER} `);
        expect(chunks.join("")).toBe(`${POLICY_CHECK_FILLER} That works.`);
    });

    it("skips the filler when the reply already started", async () => {
        const brain = fakeBrain([{
            parts: [text("Sure. "), { type: "tool-input-start", toolName: "check_policy" }, text("That works.")],
        }]);

        const chunks = await collect(
            streamVoiceTurn({ agent: brain, userText: "half friday?", messages: GREETING, state: createInitialCallState() }).textStream,
        );

        expect(chunks.join("")).toBe("Sure. That works.");
    });

    it("drops the negotiation reply and streams the handoff reply when Jev flags handoff", async () => {
        vi.mocked(evaluateSignals).mockResolvedValue(signals("handoff"));
        const brain = fakeBrain([
            { parts: [text("You can pay half now. ")] },
            { parts: [text("I'm sorry to hear that. Someone will follow up.")] },
        ]);
        const state = createInitialCallState();

        const turn = streamVoiceTurn({ agent: brain, userText: "I lost my job", messages: GREETING, state });
        const chunks = await collect(turn.textStream);

        expect(chunks.join("")).toBe("I'm sorry to hear that. Someone will follow up.");
        expect(brain.calls[0]?.aborted).toBe(true);
        expect(state.handoffActive).toBe(true);
    });

    it("gives Jev the repair history along with the transcript", async () => {
        const brain = fakeBrain([{ parts: [text("Thanks.")] }]);

        await streamVoiceTurn({ agent: brain, userText: "tap still drips", messages: GREETING, state: createInitialCallState() }).result;

        expect(evaluateSignals).toHaveBeenCalledWith(expect.objectContaining({
            maintenanceSummary: "Kitchen tap dripping: open, reported 2026-09-21",
        }));
    });

    it("speaks the final tool say line and records the turn in history and transcript", async () => {
        const brain = fakeBrain([{
            parts: [{ type: "tool-input-start", toolName: "accept_plan" }],
            steps: [{ text: "", toolCalls: [{}], toolResults: [{ output: { say: "You're all set." } }] }],
            responseMessages: [{ role: "assistant", content: [] }],
        }]);
        const state = createInitialCallState();

        const turn = streamVoiceTurn({ agent: brain, userText: "deal", messages: GREETING, state });
        const chunks = await collect(turn.textStream);
        const result = await turn.result;

        expect(chunks.join("")).toBe("You're all set.");
        expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "You're all set." });
        expect(state.transcriptLines).toEqual(["Tenant: deal", "Agent: You're all set."]);
    });

    it("finishes the turn even when the listener stops reading (barge-in)", async () => {
        const brain = fakeBrain([{ parts: [text("First. "), text("Second.")] }]);

        const turn = streamVoiceTurn({ agent: brain, userText: "hi", messages: GREETING, state: createInitialCallState() });
        const iterator = turn.textStream[Symbol.asyncIterator]();
        await iterator.next();
        await iterator.return?.();

        expect((await turn.result).assistantText).toBe("First. Second.");
    });
});
