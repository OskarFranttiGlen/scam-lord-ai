import { EventEmitter } from "node:events";

import { voice } from "@livekit/agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPLAY_DELAY_MS, replaySkippedSpeech, type TReplaySession } from "../replay-skipped-speech";

const E = voice.AgentSessionEventTypes;

function asSession(value: unknown): TReplaySession {
    return value as TReplaySession;
}

function fakeSession() {
    const emitter = new EventEmitter();
    const generateReply = vi.fn();
    return {
        emitter,
        generateReply,
        session: asSession({ on: emitter.on.bind(emitter), generateReply }),
        agent: (newState: string) => emitter.emit(E.AgentStateChanged, { newState }),
        user: (newState: string) => emitter.emit(E.UserStateChanged, { newState }),
        heard: (transcript: string, isFinal = true) => emitter.emit(E.UserInputTranscribed, { transcript, isFinal }),
        committed: (role = "user") => emitter.emit(E.ConversationItemAdded, { item: { type: "message", role } }),
        said: (text: string) => emitter.emit(E.ConversationItemAdded, { item: { type: "message", role: "assistant", textContent: text } }),
    };
}

describe("replaySkippedSpeech", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("answers what the tenant said while the agent was talking, once it finishes", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.user("speaking");
        s.heard("Yep.");
        s.user("listening");
        s.agent("listening");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).toHaveBeenCalledWith({ userInput: "Yep." });
    });

    it("joins several skipped finals into one reply", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.heard("Yes.");
        s.heard("Yep.", false);
        s.heard("That's me.");
        s.agent("listening");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).toHaveBeenCalledTimes(1);
        expect(s.generateReply).toHaveBeenCalledWith({ userInput: "Yes. That's me." });
    });

    it("also replays speech heard while the agent was thinking", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("thinking");
        s.heard("Actually, wait.");
        s.agent("speaking");
        s.agent("listening");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).toHaveBeenCalledWith({ userInput: "Actually, wait." });
    });

    it("does nothing when LiveKit commits the turn itself", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.heard("Sure.");
        s.agent("listening");
        s.committed();
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).not.toHaveBeenCalled();
    });

    it("leaves it to the normal turn when the tenant is still talking", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.user("speaking");
        s.heard("Yeah, so");
        s.agent("listening");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).not.toHaveBeenCalled();
    });

    it("ignores speech heard while the agent is listening", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("listening");
        s.heard("Hello?");
        s.agent("thinking");
        s.agent("speaking");
        s.agent("listening");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).not.toHaveBeenCalled();
    });

    it("answers a one-word reply to a later question", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.agent("listening");
        s.agent("thinking");
        s.agent("speaking");
        s.heard("Yes.");
        s.agent("listening");
        s.said("Is that a yes? I'll send the link now.");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).toHaveBeenCalledWith({ userInput: "Yes." });
    });

    it("ignores short speech over a later reply that asked nothing", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.agent("listening");
        s.agent("thinking");
        s.agent("speaking");
        s.heard("Yeah.");
        s.agent("listening");
        s.said("It's on your phone.");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).not.toHaveBeenCalled();
    });

    it("drops the replay if the agent starts speaking again first", () => {
        const s = fakeSession();
        replaySkippedSpeech(s.session);

        s.agent("speaking");
        s.heard("Okay.");
        s.agent("listening");
        s.agent("thinking");
        vi.advanceTimersByTime(REPLAY_DELAY_MS);

        expect(s.generateReply).not.toHaveBeenCalled();
    });
});
