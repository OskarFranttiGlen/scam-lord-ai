/**
 * @module voice/turn
 *
 * HTTP entry for one ScamLord collection voice **ToolLoopAgent** turn.
 * LiveKit worker posts STT text; response is spoken text plus updated call state.
 *
 * Depends on: @/voice/agent, @/voice/run-turn, @/voice/context
 * Used by: LiveKit voice pipeline (hackathon)
 */

import { after, NextResponse } from "next/server";
import type { ModelMessage } from "ai";

import { createCollectionVoiceAgent } from "@/voice/agent";
import { runVoiceTurn } from "@/voice/run-turn";
import { waitForFulfilment } from "@/voice/tools";
import {
    getDemoCallContext,
    normalizeCallState,
    type CallContext,
    type CallState,
} from "@/voice/context";

export const maxDuration = 120;

function readUserText(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
}

function readCallContext(value: unknown): CallContext {
    if (value != null && typeof value === "object") {
        return value as CallContext;
    }
    return getDemoCallContext();
}

function readMessages(value: unknown): ModelMessage[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value as ModelMessage[];
}

/**
 * POST body: `{ callContext?, callState?, userText, messages? }`
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const userText = readUserText(body.userText);

        if (!userText) {
            return NextResponse.json({ error: "userText required" }, { status: 400 });
        }

        const callContext = readCallContext(body.callContext);
        const callState: CallState = normalizeCallState(body.callState);
        const messages = readMessages(body.messages);

        const agent = createCollectionVoiceAgent({
            context: callContext,
            state: callState,
        });

        const { assistantText, messages: nextMessages, state } = await runVoiceTurn({
            agent,
            userText,
            messages,
            state: callState,
        });

        after(() => waitForFulfilment(state));

        return NextResponse.json({
            assistantText,
            callState: state,
            messages: nextMessages,
        });
    } catch (error) {
        console.error("[voice/turn] failed:", error);
        return NextResponse.json(
            { error: "Failed to process voice turn" },
            { status: 500 },
        );
    }
}
