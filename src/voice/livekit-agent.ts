/**
 * @module voice/livekit-agent
 *
 * LiveKit `voice.Agent` whose `llmNode` delegates to the collection ToolLoopAgent brain
 * ({@link streamVoiceTurn}), streaming sentences to TTS as they are ready. LiveKit owns end-of-turn detection, interruptions, and TTS; the
 * brain owns model messages and {@link CallState} across turns. Also builds the templated
 * disclosure-first greetings (no LLM call) per docs/SPEC.md, outbound and callback, and seeds a
 * callback's brain history with the previous conversation.
 *
 * Depends on: @livekit/agents, ai, ./agent, ./context, ./run-turn
 * Used by: @/voice/worker.ts, @/voice/unknown-caller.ts
 */

import { llm, log, voice } from "@livekit/agents";
import type { ModelMessage } from "ai";
import { ReadableStream } from "node:stream/web";

import type { TCollectionVoiceAgent } from "./agent";
import { managerLabel } from "./call-opening";
import type { CallContext, CallState } from "./context";
import { streamVoiceTurn, type TStreamVoiceTurn } from "./run-turn";

const FALLBACK_REPLY = "Sorry, I had a brief connection issue. Could you say that again?";

/** Timing for the most recent brain turn, read by the worker's latency log. */
export type TBrainTurnTiming = {
    userText: string;
    /** End of tenant speech → brain start, ms (undefined when LiveKit did not report it). */
    eouToBrainMs?: number;
    brainMs: number;
    replyChars: number;
    failed: boolean;
};

export type TScamLordVoiceAgentProps = {
    brain: TCollectionVoiceAgent;
    state: CallState;
    greeting: string;
    /** Callback only: summary of the last conversation, seeded ahead of the greeting. */
    priorConversation?: string | null;
};

/**
 * `LLM` placeholder so `AgentActivity` runs its pipeline reply path. Never called: agents
 * using it override `llmNode`, which replaces the default node that would.
 */
export class BrainPlaceholderLLM extends llm.LLM {
    get model(): string {
        return "scamlord-collection-brain";
    }

    /** @returns Label surfaced in LiveKit telemetry */
    label(): string {
        return "scamlord.tool-loop-agent";
    }

    /** Throws: inference is routed through the agent's `llmNode` override instead. */
    chat(): llm.LLMStream {
        throw new Error("BrainPlaceholderLLM.chat should never run; llmNode is overridden");
    }
}

const ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Spells 0–99 in words.
 *
 * @param n - Integer in [0, 99]
 */
function wordsBelowHundred(n: number): string {
    if (n < 20) {
        return ONES[n];
    }
    const tens = TENS[Math.floor(n / 10)];
    return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

/**
 * Spells 0–9999 in words, preferring spoken "eighteen hundred forty" for 1100–9999.
 *
 * @param n - Non-negative integer below 10,000
 */
function wordsBelowTenThousand(n: number): string {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (hundreds === 0) {
        return wordsBelowHundred(rest);
    }
    const head = hundreds % 10 === 0
        ? `${ONES[hundreds / 10]} thousand`
        : `${wordsBelowHundred(hundreds)} hundred`;
    return rest === 0 ? head : `${head} ${wordsBelowHundred(rest)}`;
}

/**
 * Spells a non-negative integer in words.
 *
 * @param n - Non-negative integer
 */
function integerToWords(n: number): string {
    if (n < 10_000) {
        return wordsBelowTenThousand(n);
    }
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = `${integerToWords(thousands)} thousand`;
    return rest === 0 ? head : `${head} ${wordsBelowTenThousand(rest)}`;
}

/**
 * Spells a dollar amount for TTS, e.g. 1840 → "eighteen hundred forty dollars".
 *
 * @param amount - Amount in dollars (cents rounded)
 */
export function dollarsToWords(amount: number): string {
    const totalCents = Math.round(Math.abs(amount) * 100);
    const dollars = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    const dollarPart = `${integerToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
    if (cents === 0) {
        return dollarPart;
    }
    return `${dollarPart} and ${integerToWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
}

/**
 * First line of an outbound call (no LLM call): identity and who is calling, no amounts. The
 * rest of the opening ({@link buildRentOpening}) waits for the tenant to confirm.
 *
 * @param context - Tenancy + invoice snapshot for the call
 */
export function buildOpeningGreeting(context: CallContext): string {
    const firstName = context.tenantName.trim().split(/\s+/)[0] || context.tenantName;
    return `Hi, is this ${firstName}? This is RentRecovery, calling for ${managerLabel(context)}.`;
}

/**
 * Disclosure-first greeting when a known tenant calls back (no LLM call). A handed-off caller
 * hears that a person will follow up, with no amounts.
 *
 * @param context - Tenancy + invoice snapshot for the caller
 * @param options.handoffActive - An earlier handoff still holds
 */
export function buildCallbackGreeting(context: CallContext, { handoffActive }: { handoffActive: boolean }): string {
    const firstName = context.tenantName.trim().split(/\s+/)[0] || context.tenantName;
    const opening = `Hi ${firstName}, thanks for calling ${managerLabel(context)}. This is RentRecovery.`;
    return handoffActive
        ? `${opening} Someone from the property will follow up with you personally. Can I take a message for them?`
        : `${opening} How can I help today?`;
}

/**
 * Brain history for the start of a call: the prior conversation as a labelled context message
 * (the AI SDK rejects system messages here), then the greeting already spoken.
 *
 * @param priorConversation - Summary from {@link loadCallbackSetup}, or `null`
 * @param greeting - Opening line spoken on this call
 */
export function buildCallbackHistory(priorConversation: string | null, greeting: string): ModelMessage[] {
    const spoken: ModelMessage = { role: "assistant", content: greeting };
    if (!priorConversation) {
        return [spoken];
    }
    return [
        {
            role: "user",
            content: "[Context note, not said on this call: the tenant is calling back. Pick up where the "
                + "last conversation left off and do not repeat what was already agreed or asked.]\n"
                + priorConversation,
        },
        spoken,
    ];
}

/**
 * User messages in the chat context not yet handled by the agent.
 *
 * @param chatCtx - LiveKit chat context
 * @param processedIds - Ids of user messages already answered
 */
function pendingUserMessages(chatCtx: llm.ChatContext, processedIds: Set<string>): llm.ChatMessage[] {
    return chatCtx.items.filter(
        (item): item is llm.ChatMessage => item.type === "message"
            && item.role === "user"
            && !processedIds.has(item.id),
    );
}

/**
 * Newest unhandled user message, for end-of-speech timing.
 *
 * @param chatCtx - LiveKit chat context
 * @param processedIds - Ids of user messages already answered
 */
function latestUserMessage(chatCtx: llm.ChatContext, processedIds: Set<string>): llm.ChatMessage | undefined {
    return pendingUserMessages(chatCtx, processedIds).at(-1);
}

/**
 * Joins every unhandled user message into one utterance and marks them handled.
 *
 * @param chatCtx - LiveKit chat context including the just-completed user message
 * @param processedIds - Ids of user messages already answered (mutated)
 */
export function takePendingUserText(chatCtx: llm.ChatContext, processedIds: Set<string>): string {
    const pending = pendingUserMessages(chatCtx, processedIds);
    for (const message of pending) {
        processedIds.add(message.id);
    }
    return pending
        .map((message) => message.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
}

/**
 * Collection voice agent: one {@link streamVoiceTurn} per completed tenant turn.
 */
export class ScamLordVoiceAgent extends voice.Agent {
    readonly #brain: TCollectionVoiceAgent;
    readonly #state: CallState;
    readonly #processedUserMessageIds = new Set<string>();
    readonly #logger = log();
    #messages: ModelMessage[];
    #brainChain: Promise<void> = Promise.resolve();
    #lastTiming?: TBrainTurnTiming;

    /**
     * @param props.brain - Collection ToolLoopAgent
     * @param props.state - Mutable call state shared with brain tools
     * @param props.greeting - Opening line already spoken (seeded into brain history)
     * @param props.priorConversation - Callback context seeded before the greeting
     */
    constructor({ brain, state, greeting, priorConversation = null }: TScamLordVoiceAgentProps) {
        super({
            instructions: "ScamLord AI rent collection call. Replies come from the collection brain.",
            llm: new BrainPlaceholderLLM(),
        });
        this.#brain = brain;
        this.#state = state;
        this.#messages = buildCallbackHistory(priorConversation, greeting);
        state.transcriptLines.push(`Agent: ${greeting}`);
    }

    /** Brain history (model messages) after the latest completed turn. */
    get messages(): ModelMessage[] {
        return this.#messages;
    }

    /** Timing of the latest brain turn, or undefined before the first tenant turn. */
    get lastTiming(): TBrainTurnTiming | undefined {
        return this.#lastTiming;
    }

    /**
     * Replaces LiveKit's LLM inference with one brain turn over the new tenant text.
     *
     * @param chatCtx - LiveKit chat context including the just-completed user message
     */
    override async llmNode(chatCtx: llm.ChatContext): Promise<ReadableStream<string> | null> {
        const stoppedSpeakingAt = latestUserMessage(chatCtx, this.#processedUserMessageIds)?.metrics.stoppedSpeakingAt;
        const userText = takePendingUserText(chatCtx, this.#processedUserMessageIds);
        if (!userText) {
            return null;
        }

        const chunks = this.#runBrainTurn(userText, stoppedSpeakingAt);

        return new ReadableStream<string>({
            async pull(controller) {
                const next = await chunks.next();
                if (next.done) {
                    controller.close();
                } else {
                    controller.enqueue(next.value);
                }
            },
            async cancel() {
                await chunks.return(undefined);
            },
        });
    }

    /**
     * Queues one brain turn behind any in-flight turn so history stays linear. The turn runs
     * to completion even if the tenant barges in and LiveKit stops reading its speech.
     *
     * @param userText - Tenant utterance (all unprocessed user messages joined)
     * @param stoppedSpeakingAt - Tenant end-of-speech, epoch seconds
     */
    #runBrainTurn(userText: string, stoppedSpeakingAt: number | undefined): AsyncGenerator<string> {
        let startedAt = Date.now();
        const turn = this.#brainChain.then(() => {
            startedAt = Date.now();
            return streamVoiceTurn({
                agent: this.#brain,
                userText,
                messages: this.#messages,
                state: this.#state,
            });
        });
        const timing = () => ({
            userText,
            eouToBrainMs: stoppedSpeakingAt === undefined
                ? undefined
                : Math.round(startedAt - stoppedSpeakingAt * 1000),
            brainMs: Date.now() - startedAt,
        });
        const spoke = turn.then(({ result }) => result).then(
            (result) => {
                this.#messages = result.messages;
                const replyChars = result.assistantText.trim().length;
                this.#lastTiming = { ...timing(), replyChars: replyChars || FALLBACK_REPLY.length, failed: false };
                return replyChars > 0;
            },
            (error: unknown) => {
                this.#logger.error({ error }, "[voice/livekit-agent] voice turn failed");
                this.#lastTiming = { ...timing(), replyChars: FALLBACK_REPLY.length, failed: true };
                return false;
            },
        );
        this.#brainChain = spoke.then(() => undefined);
        return speakTurn(turn, spoke);
    }
}

/**
 * Yields a turn's spoken chunks, or the fallback line when the turn said nothing or failed.
 *
 * @param turn - Streaming turn, once it is this turn's go in the queue
 * @param spoke - Whether the finished turn produced any reply text
 */
async function* speakTurn(turn: Promise<TStreamVoiceTurn>, spoke: Promise<boolean>): AsyncGenerator<string> {
    let saidAnything = false;
    const started = await turn.catch(() => null);
    if (started) {
        for await (const chunk of started.textStream) {
            saidAnything = true;
            yield chunk;
        }
    }
    if (!saidAnything && !(await spoke)) {
        yield FALLBACK_REPLY;
    }
}
