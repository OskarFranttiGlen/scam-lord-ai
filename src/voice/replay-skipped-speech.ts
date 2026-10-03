/**
 * @module voice/replay-skipped-speech
 *
 * A one-word answer ("Yes") said while the agent is still finishing a question is below the
 * interruption word floor, so LiveKit drops it and the call stalls or ends. This replays what
 * was said during the greeting, or during any reply that asked a question, as a user turn once
 * the agent finishes. Short speech over a reply that asked nothing ("yeah" backchannels) stays
 * dropped: answering it would respond to a turn the tenant has already moved past.
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
 * Listens on the session and answers short tenant replies LiveKit skipped during agent speech.
 *
 * @param session - Voice session about to speak its greeting
 */
export function replaySkippedSpeech(session: TReplaySession): void {
    const E = voice.AgentSessionEventTypes;
    let agentBusy = false;
    let greetingDone = false;
    let userSpeaking = false;
    let lastAgentLine = "";
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
        if (ev.newState !== "listening" || !wasBusy) {
            return;
        }
        const isGreeting = !greetingDone;
        greetingDone = true;
        if (heard.length === 0) {
            return;
        }
        // Decided after the delay: the finished reply is added to the chat around this transition.
        timer = setTimeout(() => {
            timer = undefined;
            const userInput = heard.join(" ");
            heard = [];
            if (!userSpeaking && (isGreeting || lastAgentLine.includes("?"))) {
                session.generateReply({ userInput });
            }
        }, REPLAY_DELAY_MS);
    });

    session.on(E.UserStateChanged, (ev: voice.UserStateChangedEvent) => {
        userSpeaking = ev.newState === "speaking";
    });

    session.on(E.UserInputTranscribed, (ev: voice.UserInputTranscribedEvent) => {
        const transcript = ev.transcript.trim();
        if (agentBusy && ev.isFinal && transcript) {
            heard.push(transcript);
        }
    });

    session.on(E.ConversationItemAdded, (ev: voice.ConversationItemAddedEvent) => {
        if (ev.item.type !== "message") {
            return;
        }
        if (ev.item.role === "assistant") {
            lastAgentLine = ev.item.textContent ?? "";
        } else if (ev.item.role === "user") {
            heard = [];
            cancel();
        }
    });
}
