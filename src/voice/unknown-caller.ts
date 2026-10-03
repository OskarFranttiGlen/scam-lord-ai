/**
 * @module voice/unknown-caller
 *
 * Callback from a number that maps to no tenancy (docs/SPEC.md → Callback). The caller hears no
 * balance or account details: the agent discloses it is an AI assistant, takes a name and the
 * property over at most two turns, says someone will call back, and ends the call. The model
 * here gets only this call's transcript: no tenant data and no tools.
 *
 * Depends on: @livekit/agents, ai, zod, ./livekit-agent
 * Used by: @/voice/worker.ts
 */

import { llm, voice } from "@livekit/agents";
import { Output, gateway, generateText, type ModelMessage } from "ai";
import { ReadableStream } from "node:stream/web";
import { z } from "zod";

import { AGENT_NAME } from "./call-opening";
import { BrainPlaceholderLLM, takePendingUserText } from "./livekit-agent";

/** Gateway model for the unknown-caller flow. */
const UNKNOWN_CALLER_MODEL = "anthropic/claude-haiku-4.5";

/** Caller turns before the agent closes regardless of what it collected. */
const MAX_CALLER_TURNS = 2;

export const UNKNOWN_CALLER_GREETING = `Thanks for calling. I'm ${AGENT_NAME}, an AI assistant for the property manager. `
    + "Can I get your name and the property you're calling about? Someone will call you back.";

export const UNKNOWN_CALLER_ASK_AGAIN = "Sorry, could you tell me your name and the property you're calling about?";

export const UNKNOWN_CALLER_CLOSING = "Thank you. Someone from the property will call you back at this number soon. "
    + "Goodbye.";

/** Anything that sounds like account details falls back to the scripted question. */
const ACCOUNT_DETAIL_PATTERN = /[$\d]|dollar|balance|\bowe|invoice|amount|installment|payment plan/i;

const INSTRUCTIONS = [
    "You answer the phone for a property manager. You are an AI assistant and say so if asked.",
    "This caller's number is not on file. You know nothing about any tenant, account, balance, invoice, or",
    "payment, and you must never discuss, confirm, or guess any of it. If they ask, say someone from the",
    "property will go over it when they call back.",
    "Your only job is to learn the caller's name and which property they are calling about.",
    "Reply with one short spoken sentence asking for whatever is still missing. No numbers, no lists.",
    "Set haveName / haveProperty to whether the caller has given each one anywhere in the conversation.",
].join("\n");

const replySchema = z.object({
    reply: z.string(),
    haveName: z.boolean(),
    haveProperty: z.boolean(),
});

export type TUnknownCallerModel = (transcriptLines: string[]) => Promise<z.infer<typeof replySchema>>;

export type TUnknownCallerTurn = {
    reply: string;
    /** The closing line was given; hang up once it has been spoken. */
    done: boolean;
};

/**
 * Default {@link TUnknownCallerModel}: one structured Claude Haiku call over the transcript.
 *
 * @param transcriptLines - `Agent: …` / `Caller: …` lines of this call only
 */
const generateUnknownCallerReply: TUnknownCallerModel = async (transcriptLines) => {
    const messages: ModelMessage[] = transcriptLines.map((line) => (line.startsWith("Agent: ")
        ? { role: "assistant", content: line.slice("Agent: ".length) }
        : { role: "user", content: line.replace(/^Caller: /, "") }));
    const result = await generateText({
        model: gateway(UNKNOWN_CALLER_MODEL),
        instructions: INSTRUCTIONS,
        messages,
        output: Output.object({ schema: replySchema }),
        maxOutputTokens: 150,
        temperature: 0.2,
    });
    return replySchema.parse(result.output);
};

/**
 * Decides the agent's reply to the caller's latest turn.
 *
 * @param input.transcriptLines - This call's transcript, ending with the caller's latest line
 * @param input.callerTurns - Caller turns so far, including the latest
 * @param input.model - Reply model (tests inject a fake)
 * @param input.log - Logger for model failures
 */
export async function runUnknownCallerTurn({
    transcriptLines,
    callerTurns,
    model = generateUnknownCallerReply,
    log = console,
}: {
    transcriptLines: string[];
    callerTurns: number;
    model?: TUnknownCallerModel;
    log?: Pick<Console, "warn">;
}): Promise<TUnknownCallerTurn> {
    if (callerTurns >= MAX_CALLER_TURNS) {
        return { reply: UNKNOWN_CALLER_CLOSING, done: true };
    }
    try {
        const answer = await model(transcriptLines);
        if (answer.haveName && answer.haveProperty) {
            return { reply: UNKNOWN_CALLER_CLOSING, done: true };
        }
        const reply = answer.reply.trim();
        return {
            reply: reply && !ACCOUNT_DETAIL_PATTERN.test(reply) ? reply : UNKNOWN_CALLER_ASK_AGAIN,
            done: false,
        };
    } catch (error) {
        log.warn(`[voice/unknown-caller] reply model failed; using the scripted question: ${String(error)}`);
        return { reply: UNKNOWN_CALLER_ASK_AGAIN, done: false };
    }
}

/**
 * LiveKit agent for an unknown caller: greets, collects name and property, then closes.
 */
export class UnknownCallerAgent extends voice.Agent {
    readonly transcriptLines: string[] = [`Agent: ${UNKNOWN_CALLER_GREETING}`];
    readonly #processedUserMessageIds = new Set<string>();
    #callerTurns = 0;
    #chain: Promise<unknown> = Promise.resolve();
    #done = false;

    constructor() {
        super({
            instructions: "Unknown callback caller. Replies come from the unknown-caller flow.",
            llm: new BrainPlaceholderLLM(),
        });
    }

    /** True once the closing line has been chosen. */
    get done(): boolean {
        return this.#done;
    }

    /**
     * Replies to the caller's completed turn; the closing line sets {@link done}.
     *
     * @param chatCtx - LiveKit chat context including the just-completed user message
     */
    override async llmNode(chatCtx: llm.ChatContext): Promise<ReadableStream<string> | null> {
        const userText = takePendingUserText(chatCtx, this.#processedUserMessageIds);
        if (!userText || this.#done) {
            return null;
        }
        const reply = this.#chain.then(async () => {
            this.#callerTurns += 1;
            this.transcriptLines.push(`Caller: ${userText}`);
            const turn = await runUnknownCallerTurn({
                transcriptLines: this.transcriptLines,
                callerTurns: this.#callerTurns,
            });
            this.transcriptLines.push(`Agent: ${turn.reply}`);
            this.#done ||= turn.done;
            return turn.reply;
        });
        this.#chain = reply;
        return new ReadableStream<string>({
            async start(controller) {
                controller.enqueue(await reply);
                controller.close();
            },
        });
    }
}
