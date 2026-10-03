/**
 * @module voice/replay-skipped-speech
 *
 * Interruptions are off so phone noise never cuts the agent off, but LiveKit then drops any
 * tenant turn that ends while the agent is talking ("skipping user input, current speech
 * generation cannot be interrupted"). A "Yep" over the greeting was lost and the call sat in
 * silence. This replays those finals as a user turn once the agent finishes speaking.
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
 * Listens on the session and answers tenant speech that LiveKit skipped during agent speech.
 *
 * @param session - Voice session with interruptions disabled
 */
export function replaySkippedSpeech(session: TReplaySession): void {
    const E = voice.AgentSessionEventTypes;
    let agentSpeaking = false;
    let userSpeaking = false;
    let heard: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
        clearTimeout(timer);
        timer = undefined;
    };

    session.on(E.AgentStateChanged, (ev: voice.AgentStateChangedEvent) => {
        // A reply is already scheduled (and uninterruptible) while the agent is thinking.
        agentSpeaking = ev.newState === "speaking" || ev.newState === "thinking";
        cancel();
        if (ev.newState !== "listening" || heard.length === 0) {
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
        if (agentSpeaking && ev.isFinal && transcript) {
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
