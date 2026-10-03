/**
 * @module voice/run-turn
 *
 * Runs one tenant spoken turn through the collection voice agent. Jev signal evaluation
 * starts concurrently with the negotiation generation; if Jev says handoff, that
 * generation is aborted and the turn is regenerated in handoff mode (no tools).
 *
 * Depends on: ai, @/collection/jev, ./agent, ./context
 * Used by: /api/voice/turn, @/voice/worker.ts, @/voice/livekit-agent.ts, @/text/handle-inbound-text.ts
 */

import type { ModelMessage } from "ai";

import { applyJevOutcome, applyStopAndPerson } from "@/collection/apply-signals";
import { evaluateSignals } from "@/collection/jev";
import type { TSignalDecision } from "@/collection/types";
import { hasAssistantLine, type TCollectionVoiceAgent } from "./agent";
import type { CallState } from "./context";

export type TRunVoiceTurnInput = {
    agent: TCollectionVoiceAgent;
    userText: string;
    messages?: ModelMessage[];
    state: CallState;
};

export type TRunVoiceTurnResult = {
    assistantText: string;
    messages: ModelMessage[];
    state: CallState;
};

type TAgentResult = Awaited<ReturnType<TCollectionVoiceAgent["generate"]>>;

type TSignalInputs = Pick<TCollectionVoiceAgent, "signalConstraints" | "signalMaintenanceSummary">;

/** Spoken right away when a slow tool starts before any reply text, so the line is not silent. */
export const POLICY_CHECK_FILLER = "Let me check that.";
const FILLER_TOOLS = new Set(["check_policy", "confirm_payment"]);

/** The subset of AI SDK stream parts the voice turn reads. */
export type TBrainStreamPart = { type: string; text?: string; toolName?: string };

/** The subset of an AI SDK step the voice turn reads. */
export type TBrainStep = {
    text: string;
    toolCalls: readonly unknown[];
    toolResults: ReadonlyArray<{ output: unknown }>;
};

export type TBrainStream = {
    fullStream: AsyncIterable<TBrainStreamPart>;
    steps: PromiseLike<readonly TBrainStep[]>;
    response: PromiseLike<{ messages: ModelMessage[] }>;
};

/** What {@link streamVoiceTurn} needs from the collection agent. */
export type TStreamingVoiceBrain = Pick<
    TCollectionVoiceAgent,
    "signalGate" | "signalConstraints" | "signalMaintenanceSummary" | "disclosureLine" | "formatReply"
> & {
    stream(options: { messages: ModelMessage[]; abortSignal?: AbortSignal }): PromiseLike<TBrainStream>;
};

export type TStreamVoiceTurnInput = Omit<TRunVoiceTurnInput, "agent"> & { agent: TStreamingVoiceBrain };

export type TStreamVoiceTurn = {
    /** Spoken chunks (whole sentences) as they are ready. Stopping early does not stop the turn. */
    textStream: AsyncIterable<string>;
    /** Settles when the whole turn is done and recorded on state. */
    result: Promise<TRunVoiceTurnResult>;
};

/**
 * Runs Jev on the transcript so far and records the check on call state.
 *
 * @param state - Mutable call state; `handoffActive` latches on a handoff decision
 * @param signals.signalConstraints - Landlord limits included in the Jev state
 * @param signals.signalMaintenanceSummary - Repair history included in the Jev state
 */
async function evaluateTurnSignals(
    state: CallState,
    { signalConstraints, signalMaintenanceSummary }: TSignalInputs,
): Promise<TSignalDecision> {
    const result = await evaluateSignals({
        transcript: state.transcriptLines.join("\n"),
        maintenanceSummary: signalMaintenanceSummary,
        constraints: signalConstraints,
    });
    state.jevChecks.push(result.record);
    const decision: TSignalDecision = { decision: result.decision, reasons: result.reasons, playbook: result.playbook };
    return decision;
}

/**
 * Spoken `say` line from the final step's tool results, when the loop stopped on a tool
 * result that already carries its own reply (accept_plan, check_policy, confirm_payment,
 * send_assistance_referral — see SPEAKABLE_TOOLS in agent.ts) instead of a text step.
 *
 * @param steps - Agent steps, in order
 */
function finalToolSay(steps: readonly TBrainStep[]): string {
    const last = steps.at(-1);
    if (!last?.toolResults.length) {
        return "";
    }
    return last.toolResults
        .map(({ output }) => (
            output != null && typeof output === "object" && "say" in output && typeof output.say === "string"
                ? output.say
                : ""
        ))
        .filter(Boolean)
        .join(" ");
}

/**
 * Builds the spoken reply from every step; `result.text` is only the final step and would
 * drop speech emitted alongside a tool call. Text written in a tool-call step precedes the
 * tool result ("let me check…"), so it is spoken only when no later step or tool `say`
 * line supersedes it.
 *
 * @param result - Agent generate result
 */
function collectStepText(result: TAgentResult): string {
    const toolSay = finalToolSay(result.steps);
    const texts = result.steps.map(step => ({
        text: step.text.trim(),
        calledTool: step.toolCalls.length > 0,
    }));
    if (toolSay) {
        texts.push({ text: toolSay, calledTool: false });
    }
    const hasFinalSpeech = texts.some(entry => entry.text && !entry.calledTool);
    return texts
        .filter(entry => entry.text && !(hasFinalSpeech && entry.calledTool))
        .map(entry => entry.text)
        .join(" ");
}

/**
 * Appends the tenant line, runs the agent loop once, and records the assistant reply.
 *
 * @param input.agent - Preconfigured collection ToolLoopAgent
 * @param input.userText - Latest tenant utterance (STT text)
 * @param input.messages - Prior model messages for multi-turn calls
 * @param input.state - Mutable call state updated by tools during the turn
 */
export async function runVoiceTurn({
    agent,
    userText,
    messages = [],
    state,
}: TRunVoiceTurnInput): Promise<TRunVoiceTurnResult> {
    const trimmed = userText.trim();
    if (!trimmed) {
        return { assistantText: "", messages, state };
    }

    state.transcriptLines.push(`Tenant: ${trimmed}`);
    applyStopAndPerson(state, trimmed);

    const turnMessages: ModelMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
    ];

    let result: TAgentResult;
    if (state.handoffActive) {
        result = await agent.generate({ messages: turnMessages });
    } else {
        const signals = evaluateTurnSignals(state, agent).catch((error: unknown) => {
            console.warn("[voice/run-turn] signal evaluation failed; continuing:", error);
            return { decision: "continue", reasons: [] } satisfies TSignalDecision;
        });
        agent.signalGate.pending = signals;

        const controller = new AbortController();
        const negotiation = agent.generate({ messages: turnMessages, abortSignal: controller.signal });
        negotiation.catch(() => undefined);

        try {
            const decision = await signals;
            applyJevOutcome(state, decision);
            if (state.handoffActive) {
                controller.abort();
                result = await agent.generate({ messages: turnMessages });
            } else {
                result = await negotiation;
            }
        } finally {
            agent.signalGate.pending = null;
        }
    }

    const endedOnTool = Boolean(finalToolSay(result.steps));
    let assistantText = agent.formatReply(collectStepText(result));
    if (assistantText && !hasAssistantLine(messages) && !/\bAI\b/.test(assistantText)) {
        assistantText = `${agent.disclosureLine} ${assistantText}`;
    }
    state.transcriptLines.push(`Agent: ${assistantText}`);

    const updatedMessages: ModelMessage[] = result.responseMessages?.length
        ? [...turnMessages, ...result.responseMessages]
        : [...turnMessages];
    if (endedOnTool || !result.responseMessages?.length) {
        updatedMessages.push({ role: "assistant", content: assistantText });
    }

    return {
        assistantText,
        messages: updatedMessages,
        state,
    };
}

/**
 * Splits off every complete sentence (ending in `.`, `!`, or `?` plus whitespace) so TTS
 * can start before the reply is finished.
 *
 * @param buffer - Unspoken model text
 */
function takeSentences(buffer: string): { ready: string; rest: string } {
    const match = /^[\s\S]*[.!?]["')\]]?\s/.exec(buffer);
    return match
        ? { ready: match[0], rest: buffer.slice(match[0].length) }
        : { ready: "", rest: buffer };
}

/**
 * Push queue read as an async iterable; pushes after the reader stops are dropped.
 */
function createChunkQueue(): { iterable: AsyncIterable<string>; push(chunk: string): void; close(): void } {
    const chunks: string[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    const notify = () => {
        wake?.();
        wake = null;
    };
    return {
        push(chunk) {
            chunks.push(chunk);
            notify();
        },
        close() {
            closed = true;
            notify();
        },
        iterable: {
            async* [Symbol.asyncIterator]() {
                while (true) {
                    const next = chunks.shift();
                    if (next !== undefined) {
                        yield next;
                    } else if (closed) {
                        return;
                    } else {
                        await new Promise<void>(resolve => { wake = resolve; });
                    }
                }
            },
        },
    };
}

/**
 * Streaming {@link runVoiceTurn} for live calls: speech starts on the first finished sentence,
 * and a short filler line covers a policy or payment check that starts before any reply.
 * Nothing is spoken until Jev clears the turn; on a handoff the negotiation reply is dropped
 * and the handoff reply streams instead.
 *
 * @param input.agent - Collection agent (or any brain with the same streaming surface)
 * @param input.userText - Latest tenant utterance (STT text)
 * @param input.messages - Prior model messages for multi-turn calls
 * @param input.state - Mutable call state updated by tools during the turn
 */
export function streamVoiceTurn({
    agent,
    userText,
    messages = [],
    state,
}: TStreamVoiceTurnInput): TStreamVoiceTurn {
    const queue = createChunkQueue();
    const trimmed = userText.trim();
    if (!trimmed) {
        queue.close();
        return { textStream: queue.iterable, result: Promise.resolve({ assistantText: "", messages, state }) };
    }

    state.transcriptLines.push(`Tenant: ${trimmed}`);
    applyStopAndPerson(state, trimmed);
    const turnMessages: ModelMessage[] = [...messages, { role: "user", content: trimmed }];
    const disclosed = hasAssistantLine(messages);
    const spoken: string[] = [];

    const speak = (raw: string, trailingSpace: boolean) => {
        let line = agent.formatReply(raw);
        if (!line) {
            return;
        }
        if (!spoken.length && !disclosed && !/\bAI\b/.test(line)) {
            line = `${agent.disclosureLine} ${line}`;
        }
        spoken.push(line);
        queue.push(trailingSpace ? `${line} ` : line);
    };

    const openStream = async (): Promise<TBrainStream> => {
        if (state.handoffActive) {
            return agent.stream({ messages: turnMessages });
        }
        const signals = evaluateTurnSignals(state, agent).catch((error: unknown) => {
            console.warn("[voice/run-turn] signal evaluation failed; continuing:", error);
            return { decision: "continue", reasons: [] } satisfies TSignalDecision;
        });
        agent.signalGate.pending = signals;
        const controller = new AbortController();
        const negotiation = Promise.resolve(agent.stream({ messages: turnMessages, abortSignal: controller.signal }));
        negotiation.catch(() => undefined);
        const decision = await signals;
        applyJevOutcome(state, decision);
        if (state.handoffActive) {
            controller.abort();
            return agent.stream({ messages: turnMessages });
        }
        return negotiation;
    };

    const run = async (): Promise<TRunVoiceTurnResult> => {
        try {
            const streamed = await openStream();
            let buffer = "";
            for await (const part of streamed.fullStream) {
                if (part.type === "text-delta" && part.text) {
                    buffer += part.text;
                    const { ready, rest } = takeSentences(buffer);
                    if (ready) {
                        speak(ready, true);
                        buffer = rest;
                    }
                } else if (part.type === "tool-input-start") {
                    if (buffer.trim()) {
                        speak(buffer, true);
                        buffer = "";
                    } else if (!spoken.length && part.toolName && FILLER_TOOLS.has(part.toolName)) {
                        speak(POLICY_CHECK_FILLER, true);
                    }
                }
            }
            speak(buffer, false);

            const toolSay = finalToolSay(await streamed.steps);
            if (toolSay) {
                speak(toolSay, false);
            }

            const assistantText = spoken.join(" ");
            state.transcriptLines.push(`Agent: ${assistantText}`);
            const responseMessages = (await streamed.response).messages;
            const updatedMessages: ModelMessage[] = [...turnMessages, ...responseMessages];
            if (toolSay || !responseMessages.length) {
                updatedMessages.push({ role: "assistant", content: assistantText });
            }
            return { assistantText, messages: updatedMessages, state };
        } finally {
            agent.signalGate.pending = null;
            queue.close();
        }
    };

    return { textStream: queue.iterable, result: run() };
}
