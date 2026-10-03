/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import type { TJevCheckRecord } from "@/collection/types";
import {
    buildTextRowUpdate,
    phoneCandidates,
    resumeTextState,
    toE164,
    type TStoredCallRow,
} from "@/text/conversation-store";
import { createInitialCallState } from "@/voice/context";

const HARDSHIP_CHECK: TJevCheckRecord = {
    transcript: "Tenant: I lost my job last week",
    photoSummary: null,
    constraints: { max_installments: 2, grace_days: 14, fee_waiver_cap: 25 },
    questions: {
        hardship: { type: "boolean", instructions: "h", criteria: { true: "t", false: "f" } },
        dispute: { type: "boolean", instructions: "d", criteria: { true: "t", false: "f" } },
        distressed: { type: "boolean", instructions: "x", criteria: { true: "t", false: "f" } },
    },
    probabilities: { hardship: 0.91, dispute: 0.05, distressed: 0.3 },
    outcome: { decision: "handoff", reasons: ["hardship"] },
    evaluatedAt: "2026-10-03T18:00:00Z",
    model: "typesafe-ai/jev",
};

/**
 * A `calls` row as the store reads it.
 *
 * @param overrides - Fields that differ from an in-progress outbound call
 */
function row(overrides: Partial<TStoredCallRow>): TStoredCallRow {
    return {
        id: "call_1",
        channel: "outbound_call",
        status: "in_progress",
        handoff_reason: null,
        stripe_invoice_id: "in_1",
        transcript: null,
        jev_checks: [],
        payment_link_sent: false,
        conversation: null,
        ...overrides,
    };
}

describe("phone numbers", () => {
    it("normalizes US numbers to E.164", () => {
        expect(toE164("+1 (555) 555-0201")).toBe("+15555550201");
        expect(toE164("555.555.0201")).toBe("+15555550201");
        expect(toE164("15555550201")).toBe("+15555550201");
        expect(toE164("+447700900123")).toBe("+447700900123");
        expect(toE164("call me")).toBeNull();
    });

    it("looks up the E.164 form and the raw form", () => {
        expect(phoneCandidates("(555) 555-0201")).toEqual(["+15555550201", "(555) 555-0201"]);
    });
});

describe("resumeTextState", () => {
    it("starts a fresh thread when the tenant has never texted", () => {
        const resumed = resumeTextState([row({ id: "call_voice" })]);

        expect(resumed.textRow).toBeNull();
        expect(resumed.messages).toEqual([]);
        expect(resumed.state).toEqual(createInitialCallState());
        expect(resumed.carriedHandoffReason).toBeNull();
    });

    it("resumes the stored messages and state of the text thread", () => {
        const state = { ...createInitialCallState(), transcriptLines: ["Tenant: hi", "Agent: hello"] };
        const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
        const resumed = resumeTextState([row({ id: "call_text", channel: "text", conversation: { messages, state } })]);

        expect(resumed.textRow?.id).toBe("call_text");
        expect(resumed.messages).toEqual(messages);
        expect(resumed.state.transcriptLines).toEqual(["Tenant: hi", "Agent: hello"]);
        expect(resumed.state.handoffActive).toBe(false);
    });

    it("carries a handoff from the latest phone call into the text thread", () => {
        const resumed = resumeTextState([
            row({ id: "call_voice", status: "waiting_on_person", handoff_reason: "dispute" }),
            row({ id: "call_text", channel: "text", conversation: { messages: [], state: createInitialCallState() } }),
        ]);

        expect(resumed.state.handoffActive).toBe(true);
        expect(resumed.carriedHandoffReason).toBe("dispute");
    });

    it("keeps a text handoff even when it is the latest row", () => {
        const resumed = resumeTextState([row({ channel: "text", status: "waiting_on_person", handoff_reason: "hardship" })]);

        expect(resumed.state.handoffActive).toBe(true);
    });

    it("drops a corrupt message history instead of failing the turn", () => {
        const resumed = resumeTextState([row({ channel: "text", conversation: { messages: [{ role: "robot" }] } })]);

        expect(resumed.messages).toEqual([]);
    });
});

describe("buildTextRowUpdate", () => {
    it("stores the check-in feedback and an urgent-repair handoff reason", () => {
        const state = {
            ...createInitialCallState(),
            handoffActive: true,
            urgentMaintenance: true,
            feedbackRecorded: true,
            tenantFeedback: "No hot water since Monday",
        };

        const update = buildTextRowUpdate({ state, messages: [], previousStatus: "in_progress", carriedHandoffReason: null });

        expect(update).toMatchObject({
            status: "waiting_on_person",
            handoff_reason: "urgent_maintenance",
            tenant_feedback: "No hot water since Monday",
        });
    });

    it("marks a text handoff as waiting on a person with Jev's reason", () => {
        const state = { ...createInitialCallState(), handoffActive: true, jevChecks: [HARDSHIP_CHECK] };

        const update = buildTextRowUpdate({
            state,
            messages: [{ role: "user", content: "I lost my job" }],
            messageSid: "SM9",
            previousStatus: "in_progress",
            carriedHandoffReason: null,
        });

        expect(update).toMatchObject({
            status: "waiting_on_person",
            handoff_reason: "hardship",
            twilio_message_sid: "SM9",
            jev_checks: [HARDSHIP_CHECK],
        });
    });

    it("records a carried handoff's reason and keeps a paid thread paid", () => {
        const carried = buildTextRowUpdate({
            state: { ...createInitialCallState(), handoffActive: true },
            messages: [],
            previousStatus: "in_progress",
            carriedHandoffReason: "dispute",
        });
        const paid = buildTextRowUpdate({
            state: { ...createInitialCallState(), transcriptLines: ["Tenant: thanks", "Agent: you're welcome"] },
            messages: [],
            previousStatus: "paid",
            carriedHandoffReason: null,
        });

        expect(carried).toMatchObject({ status: "waiting_on_person", handoff_reason: "dispute" });
        expect(paid).toMatchObject({
            status: "paid",
            handoff_reason: null,
            transcript: "Tenant: thanks\nAgent: you're welcome",
        });
    });
});
