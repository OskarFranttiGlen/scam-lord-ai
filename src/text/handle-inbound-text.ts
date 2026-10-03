/**
 * @module text/handle-inbound-text
 *
 * One inbound SMS → one agent reply (docs/SPEC.md, Text). Twilio's opt-out and help keywords
 * are left to Twilio. The sender's number maps to a tenancy; an unknown number gets a short
 * follow-up line with no account details. A known tenant's text runs one turn of the same
 * collection ToolLoopAgent used on calls (text channel), and the thread is saved on the
 * tenancy's `calls` row with channel `text`. Never throws.
 *
 * Depends on: ./conversation-store, @/voice/agent, @/voice/run-turn, @/voice/tools,
 * @/voice/supabase-client
 * Used by: /api/sms/inbound
 */

import { findTenancyIdByPhone, loadTextConversation, saveTextConversation } from "./conversation-store";
import { createCollectionVoiceAgent } from "@/voice/agent";
import { runVoiceTurn } from "@/voice/run-turn";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "@/voice/supabase-client";
import { waitForFulfilment } from "@/voice/tools";

export const UNKNOWN_SENDER_REPLY = "Thanks for your message. Someone from the property will follow up.";

/** Twilio's default opt-out, opt-in, and help keywords; "yes" is left out because tenants agree with it. */
const TWILIO_KEYWORDS = new Set([
    "stop", "stopall", "unsubscribe", "cancel", "end", "quit",
    "start", "unstop",
    "help", "info",
]);

export type TInboundText = {
    /** Sender number (`From`). */
    from: string;
    body: string;
    messageSid?: string;
};

export type TInboundTextResult = {
    /** SMS reply, or `null` to send none. */
    reply: string | null;
    outcome: "keyword" | "empty" | "unknown_sender" | "replied" | "error";
    latencyMs: number;
    /** Work to finish after the response (a slow Stripe link); pass to `after()`. */
    background?: Promise<void>;
};

export type THandleInboundTextDeps = {
    /** Supabase client; `undefined` uses the env service-role client. */
    db?: TVoiceSupabaseClient | null;
    log?: Pick<Console, "info" | "warn" | "error">;
};

/**
 * True when the whole message is one of Twilio's reserved keywords.
 *
 * @param body - Message text
 */
export function isTwilioKeyword(body: string): boolean {
    return TWILIO_KEYWORDS.has(body.trim().toLowerCase().replace(/[.!]+$/, ""));
}

/**
 * Handles one inbound text and returns the reply to send.
 *
 * @param input - Sender, body, and Twilio message SID
 * @param deps - Optional Supabase client and logger overrides (tests)
 */
export async function handleInboundText(
    input: TInboundText,
    deps: THandleInboundTextDeps = {},
): Promise<TInboundTextResult> {
    const startedAt = Date.now();
    const log = deps.log ?? console;
    const done = (
        reply: string | null,
        outcome: TInboundTextResult["outcome"],
        extra: { tenancyId?: string; background?: Promise<void> } = {},
    ): TInboundTextResult => {
        const latencyMs = Date.now() - startedAt;
        log.info(`[sms/inbound] ${outcome} in ${latencyMs}ms${extra.tenancyId ? ` (tenancy ${extra.tenancyId})` : ""}`);
        return { reply, outcome, latencyMs, background: extra.background };
    };

    const body = input.body.trim();
    if (isTwilioKeyword(body)) {
        return done(null, "keyword");
    }
    if (!body) {
        return done(null, "empty");
    }

    const db = deps.db === undefined ? getVoiceSupabaseClient() : deps.db;
    if (!db) {
        log.error("[sms/inbound] Supabase is not configured; cannot match the sender");
        return done(UNKNOWN_SENDER_REPLY, "error");
    }

    let tenancyId: string | undefined;
    try {
        tenancyId = await findTenancyIdByPhone(db, input.from) ?? undefined;
        const conversation = tenancyId ? await loadTextConversation(db, tenancyId) : null;
        if (!tenancyId || !conversation) {
            return done(UNKNOWN_SENDER_REPLY, "unknown_sender");
        }

        const { context, state } = conversation;
        const agent = createCollectionVoiceAgent({ context, state, channel: "text" });
        const turn = await runVoiceTurn({ agent, userText: body, messages: conversation.messages, state });
        await saveTextConversation(db, conversation, {
            messages: turn.messages,
            state: turn.state,
            messageSid: input.messageSid,
        });

        const linkBefore = turn.state.paymentLinkUrl;
        const background = waitForFulfilment(turn.state).then(async () => {
            if (turn.state.paymentLinkUrl !== linkBefore) {
                await saveTextConversation(db, conversation, { messages: turn.messages, state: turn.state });
            }
        }).catch((error: unknown) => {
            log.error(`[sms/inbound] late save failed for tenancy ${tenancyId}: ${String(error)}`);
        });

        return done(turn.assistantText || UNKNOWN_SENDER_REPLY, "replied", { tenancyId, background });
    } catch (error) {
        log.error(`[sms/inbound] turn failed${tenancyId ? ` for tenancy ${tenancyId}` : ""}: ${String(error)}`);
        return done(UNKNOWN_SENDER_REPLY, "error", { tenancyId });
    }
}
