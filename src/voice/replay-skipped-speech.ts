/**
 * @module voice/replay-skipped-speech
 *
 * Tenants answer "Yes" over the end of the greeting. That turn is below the interruption word
 * floor, so LiveKit drops it and the call sits in silence. This replays what was said during
 * the greeting as a user turn once it finishes. Later replies rely on interruptions instead:
 * replaying there answers a turn the tenant has already moved past.
 *
 * Depends on: @livekit/agents
 * Used by: @/voice/worker.ts
 */

import { voice } from "@livekit/agents";

/** Grace period after the agent stops speaking for LiveKit to commit an in-flight turn itself. */
export const REPLAY_DELAY_MS = 800;

/** The slice of `voice.AgentSession` this needs. */
export type TReplaySession = Pick<voice.AgentSession, "on" | "generateReply">;

/**
 * Listens on the session and answers tenant speech that LiveKit skipped during the greeting.
 *
 * @param session - Voice session about to speak its greeting
 */
export function replaySkippedSpeech(session: TReplaySession): void {
    const E = voice.AgentSessionEventTypes;
    let agentBusy = false;
    let greetingDone = false;
    let userSpeaking = false;
    let heard: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
        clearTimeout(timer);
        timer = undefined;
    };

    session.on(E.AgentStateChanged, (ev: voice.AgentStateChangedEvent) => {
        const wasBusy = agentBusy;
        agentBusy = ev.newState === "speaking" || ev.newState === "thinking";
        cancel();
        if (ev.newState !== "listening" || !wasBusy || greetingDone) {
            return;
        }
        greetingDone = true;
        if (heard.length === 0) {
            return;
        }
        timer = setTimeout(() => {
            timer = undefined;
            const userInput = heard.join(" ");
            heard = [];
            if (!userSpeaking) {
                session.generateReply({ userInput });
            }
        }, REPLAY_DELAY_MS);
    });

    session.on(E.UserStateChanged, (ev: voice.UserStateChangedEvent) => {
        userSpeaking = ev.newState === "speaking";
    });

    session.on(E.UserInputTranscribed, (ev: voice.UserInputTranscribedEvent) => {
        const transcript = ev.transcript.trim();
        if (agentBusy && !greetingDone && ev.isFinal && transcript) {
            heard.push(transcript);
        }
    });

    session.on(E.ConversationItemAdded, (ev: voice.ConversationItemAddedEvent) => {
        if (ev.item.type === "message" && ev.item.role === "user") {
            heard = [];
            cancel();
        }
    });
}
