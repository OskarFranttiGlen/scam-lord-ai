import { describe, expect, it, vi } from "vitest";

import { collectionCallSettings } from "../agent";
import { createInitialCallState, normalizeCallState, type CallContext } from "../context";
import { getDemoCallContext } from "../demo-context";
import { buildHandoffInstructions, buildNegotiationInstructions } from "../instructions";
import { getCollectionTools } from "../tools";

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };

function context(overrides: Partial<CallContext> = {}): CallContext {
    return { ...getDemoCallContext(), maintenanceRequests: [], ...overrides };
}

describe("end_call tool", () => {
    it("marks the call ended and tells the agent to say goodbye", async () => {
        const state = createInitialCallState();
        const onStateChange = vi.fn();
        const tools = getCollectionTools(context(), state, { channel: "voice", onStateChange });

        const result = await tools.end_call.execute?.({ reason: "done" }, TOOL_OPTIONS);

        expect(state.callEnded).toBe(true);
        expect(onStateChange).toHaveBeenCalledWith(state);
        expect(result).toMatchObject({ status: "ending", next: "Say a short goodbye in the same reply." });
    });

    it("accepts the wrong-person and tenant-asked reasons", async () => {
        const tools = getCollectionTools(context(), createInitialCallState(), { channel: "voice" });

        await expect(tools.end_call.execute?.({ reason: "wrong_person" }, TOOL_OPTIONS))
            .resolves.toMatchObject({ status: "ending" });
        await expect(tools.end_call.execute?.({ reason: "tenant_asked" }, TOOL_OPTIONS))
            .resolves.toMatchObject({ status: "ending" });
    });
});

describe("callEnded state", () => {
    it("defaults to false and survives a JSON round-trip through normalizeCallState", () => {
        const state = createInitialCallState();
        expect(state.callEnded).toBe(false);

        state.callEnded = true;
        expect(normalizeCallState(JSON.parse(JSON.stringify(state))).callEnded).toBe(true);
        expect(normalizeCallState({ handoffActive: true }).callEnded).toBe(false);
    });
});

describe("handoff end-call settings", () => {
    it("lets the handed-off agent end the call once the check-in is recorded", () => {
        const state = createInitialCallState();
        state.handoffActive = true;
        state.feedbackRecorded = true;

        const settings = collectionCallSettings(context(), state, { disclosed: true, channel: "voice" });

        expect(settings.activeTools).toEqual(["end_call"]);
        expect(settings.toolChoice).toBe("auto");
    });

    it("keeps record_feedback and adds end_call before the check-in is recorded", () => {
        const state = createInitialCallState();
        state.handoffActive = true;

        const settings = collectionCallSettings(context(), state, { disclosed: true, channel: "voice" });

        expect(settings.activeTools).toEqual(["record_feedback", "end_call"]);
        expect(settings.toolChoice).toBe("auto");
    });
});

describe("end-call instructions", () => {
    it("tells the voice agent to end the call with a short goodbye", () => {
        const prompt = buildNegotiationInstructions(context(), true, "voice", { feedbackRecorded: true });

        expect(prompt).toMatch(/end_call/);
        expect(prompt).toMatch(/goodbye/i);
    });

    it("does not tell the text agent to end the conversation", () => {
        const prompt = buildNegotiationInstructions(context(), true, "text", { feedbackRecorded: true });

        expect(prompt).not.toMatch(/end_call/);
    });

    it("tells the voice handoff prompt to end the call after the follow-up line", () => {
        const prompt = buildHandoffInstructions(context(), true, ["hardship"], "voice");

        expect(prompt).toMatch(/end_call/);
    });

    it("does not tell the text handoff prompt to end the conversation", () => {
        const prompt = buildHandoffInstructions(context(), true, ["hardship"], "text");

        expect(prompt).not.toMatch(/end_call/);
    });
});