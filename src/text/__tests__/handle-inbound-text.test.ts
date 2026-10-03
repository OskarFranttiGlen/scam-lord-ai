/**
 * @vitest-environment node
 */
import type { ModelMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    findTenancyIdByPhone,
    loadTextConversation,
    saveTextConversation,
    type TTextConversation,
} from "@/text/conversation-store";
import { handleInboundText, UNKNOWN_SENDER_REPLY } from "@/text/handle-inbound-text";
import type { TCollectionVoiceAgent } from "@/voice/agent";
import { createInitialCallState, getDemoCallContext, type CallState } from "@/voice/context";
import { runVoiceTurn } from "@/voice/run-turn";
import type { TVoiceSupabaseClient } from "@/voice/supabase-client";

vi.mock("@/text/conversation-store", () => ({
    findTenancyIdByPhone: vi.fn(),
    loadTextConversation: vi.fn(),
    saveTextConversation: vi.fn(async () => undefined),
}));
vi.mock("@/voice/run-turn", () => ({ runVoiceTurn: vi.fn() }));

/**
 * Casts a stand-in to the Supabase client type; the store module is mocked, so it is never queried.
 *
 * @param value - Stand-in client
 */
function asClient(value: unknown): TVoiceSupabaseClient {
    return value as TVoiceSupabaseClient;
}

const DB = asClient({ from: vi.fn() });
const quietLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * A stored text conversation for the demo tenancy.
 *
 * @param state - Agent state to resume with
 * @param messages - Prior model messages
 */
function conversation(state: CallState, messages: ModelMessage[] = []): TTextConversation {
    return {
        callId: "call_text_1",
        tenancyId: "ten_1",
        context: getDemoCallContext(),
        messages,
        state,
        status: "in_progress",
        carriedHandoffReason: null,
    };
}

beforeEach(() => {
    vi.mocked(runVoiceTurn).mockImplementation(async ({ userText, messages = [], state }) => {
        state.transcriptLines.push(`Tenant: ${userText}`, "Agent: reply");
        return {
            assistantText: "Hi, this is an AI assistant for Sunset Apartments. You owe $2,400.",
            messages: [...messages, { role: "user", content: userText }, { role: "assistant", content: "reply" }],
            state,
        };
    });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("handleInboundText", () => {
    it.each(["STOP", " help ", "Unsubscribe", "start"])("leaves the Twilio keyword %j to Twilio", async body => {
        const result = await handleInboundText({ from: "+15555550201", body }, { db: DB, log: quietLog });

        expect(result.reply).toBeNull();
        expect(findTenancyIdByPhone).not.toHaveBeenCalled();
        expect(runVoiceTurn).not.toHaveBeenCalled();
    });

    it("tells an unknown number someone will follow up, with no account details", async () => {
        vi.mocked(findTenancyIdByPhone).mockResolvedValue(null);

        const result = await handleInboundText({ from: "+15550009999", body: "how much do I owe?" }, {
            db: DB,
            log: quietLog,
        });

        expect(result.reply).toBe(UNKNOWN_SENDER_REPLY);
        expect(UNKNOWN_SENDER_REPLY).toBe("Thanks for your message. Someone from the property will follow up.");
        expect(loadTextConversation).not.toHaveBeenCalled();
        expect(runVoiceTurn).not.toHaveBeenCalled();
    });

    it("runs one text-channel turn for a known tenant and saves the thread", async () => {
        const prior: ModelMessage[] = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
        vi.mocked(findTenancyIdByPhone).mockResolvedValue("ten_1");
        vi.mocked(loadTextConversation).mockResolvedValue(conversation(createInitialCallState(), prior));

        const result = await handleInboundText(
            { from: "(555) 555-0201", body: "who is this?", messageSid: "SM123" },
            { db: DB, log: quietLog },
        );

        expect(findTenancyIdByPhone).toHaveBeenCalledWith(DB, "(555) 555-0201");
        expect(loadTextConversation).toHaveBeenCalledWith(DB, "ten_1");
        const turn = vi.mocked(runVoiceTurn).mock.calls[0][0];
        expect((turn.agent satisfies TCollectionVoiceAgent).channel).toBe("text");
        expect(turn.userText).toBe("who is this?");
        expect(turn.messages).toEqual(prior);
        expect(saveTextConversation).toHaveBeenCalledWith(DB, expect.objectContaining({ callId: "call_text_1" }), {
            messages: [...prior, { role: "user", content: "who is this?" }, { role: "assistant", content: "reply" }],
            state: expect.objectContaining({ transcriptLines: ["Tenant: who is this?", "Agent: reply"] }),
            messageSid: "SM123",
        });
        expect(result.reply).toBe("Hi, this is an AI assistant for Sunset Apartments. You owe $2,400.");
    });

    it("runs the turn in handoff mode when a call already handed off", async () => {
        const state = { ...createInitialCallState(), handoffActive: true };
        vi.mocked(findTenancyIdByPhone).mockResolvedValue("ten_1");
        vi.mocked(loadTextConversation).mockResolvedValue({ ...conversation(state), carriedHandoffReason: "hardship" });

        await handleInboundText({ from: "+15555550201", body: "can I do half?" }, { db: DB, log: quietLog });

        expect(vi.mocked(runVoiceTurn).mock.calls[0][0].state.handoffActive).toBe(true);
    });

    it("still answers kindly when the turn fails", async () => {
        vi.mocked(findTenancyIdByPhone).mockResolvedValue("ten_1");
        vi.mocked(loadTextConversation).mockResolvedValue(conversation(createInitialCallState()));
        vi.mocked(runVoiceTurn).mockRejectedValue(new Error("gateway down"));

        const result = await handleInboundText({ from: "+15555550201", body: "hello" }, { db: DB, log: quietLog });

        expect(result.reply).toBe(UNKNOWN_SENDER_REPLY);
        expect(saveTextConversation).not.toHaveBeenCalled();
    });
});
