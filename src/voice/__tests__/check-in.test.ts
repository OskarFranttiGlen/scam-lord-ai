import { describe, expect, it } from "vitest";

import { collectionCallSettings } from "../agent";
import { createInitialCallState, normalizeCallState, type CallContext } from "../context";
import { getDemoCallContext } from "../demo-context";
import { buildHandoffInstructions, buildNegotiationInstructions } from "../instructions";
import { buildCallbackGreeting } from "../livekit-agent";
import { getCollectionTools } from "../tools";

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };
const TODAY_PLAN = { installments: [{ date: new Date().toISOString().slice(0, 10), amount: 1840 }] };

function context(overrides: Partial<CallContext> = {}): CallContext {
    return { ...getDemoCallContext(), maintenanceRequests: [], ...overrides };
}

const OPEN_TAP: NonNullable<CallContext["maintenanceRequests"]>[number] = {
    description: "Kitchen tap dripping",
    status: "open",
    urgency: "routine",
    reportedAt: "2026-09-21T10:00:00.000Z",
    resolvedAt: null,
};

describe("check-in gate (texts)", () => {
    it("refuses check_policy until the tenant's feedback is recorded", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        const result = await tools.check_policy.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(result).toMatchObject({ status: "check_in_first" });
    });

    it("refuses accept_plan until the tenant's feedback is recorded, and saves nothing", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        const result = await tools.accept_plan.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(result).toMatchObject({ status: "check_in_first" });
        expect(state.acceptedPlan).toBeUndefined();
        expect(state.paymentLinkSent).toBe(false);
    });

    it("opens the policy tools once record_feedback runs", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        await tools.record_feedback.execute?.(
            { summary: "All good, tap still drips", declined: false, issues: [] },
            TOOL_OPTIONS,
        );
        const result = await tools.check_policy.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(state.feedbackRecorded).toBe(true);
        expect(state.tenantFeedback).toBe("All good, tap still drips");
        expect(result).toMatchObject({ status: "accepted" });
    });

    it("records a decline as the feedback and still opens the gate", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        await tools.record_feedback.execute?.({ summary: "", declined: true, issues: [] }, TOOL_OPTIONS);

        expect(state.feedbackRecorded).toBe(true);
        expect(state.tenantFeedback).toBe("declined");
    });

    it("logs routine repairs without a handoff", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        await tools.record_feedback.execute?.(
            { summary: "Bathroom fan is noisy", declined: false, issues: [{ description: "Bathroom fan noisy", urgent: false }] },
            TOOL_OPTIONS,
        );

        expect(state.maintenanceReports).toEqual([
            expect.objectContaining({ description: "Bathroom fan noisy", urgent: false }),
        ]);
        expect(state.maintenanceReports[0].id).toMatch(/^[0-9a-f-]{36}$/);
        expect(state.handoffActive).toBe(false);
        expect(state.urgentMaintenance).toBe(false);
    });

    it("hands off on an urgent repair and blocks collection for the rest of the conversation", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state, { channel: "text" });

        await tools.record_feedback.execute?.(
            { summary: "Ceiling leaking", declined: false, issues: [{ description: "Water leaking through bedroom ceiling", urgent: true }] },
            TOOL_OPTIONS,
        );
        const accept = await tools.accept_plan.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(state.handoffActive).toBe(true);
        expect(state.urgentMaintenance).toBe(true);
        expect(accept).toMatchObject({ status: "handoff" });
        expect(state.acceptedPlan).toBeUndefined();
    });

    it("keeps check-in fields when call state round-trips through JSON", () => {
        const state = createInitialCallState();
        state.feedbackRecorded = true;
        state.tenantFeedback = "fine";
        state.urgentMaintenance = true;
        state.maintenanceReports = [{ id: "5f0c3a52-8a8e-4c8e-9a51-0b0f1c2d3e4f", description: "Leak", urgent: true }];

        expect(normalizeCallState(JSON.parse(JSON.stringify(state)))).toMatchObject({
            feedbackRecorded: true,
            tenantFeedback: "fine",
            urgentMaintenance: true,
            maintenanceReports: state.maintenanceReports,
        });
    });
});

describe("check-in during a handoff", () => {
    it("lets the handed-off agent log a repair the tenant raised before the check-in was recorded", () => {
        const state = createInitialCallState();
        state.handoffActive = true;

        const settings = collectionCallSettings(context(), state, { disclosed: true, channel: "voice" });

        expect(settings.activeTools).toEqual(["record_feedback"]);
        expect(settings.toolChoice).toBe("auto");
        expect(settings.instructions).toMatch(/record_feedback/);
    });

    it("gives the handed-off agent no tools once the check-in is recorded", () => {
        const state = createInitialCallState();
        state.handoffActive = true;
        state.feedbackRecorded = true;

        const settings = collectionCallSettings(context(), state, { disclosed: true, channel: "voice" });

        expect(settings.activeTools).toEqual([]);
        expect(settings.toolChoice).toBe("none");
    });
});

describe("callback greeting", () => {
    it("does not lead with the balance when a known tenant calls back", () => {
        expect(buildCallbackGreeting(context(), { handoffActive: false })).not.toMatch(/balance/i);
    });
});

describe("check-in instructions", () => {
    it("requires the check-in before money in a text thread while feedback is missing", () => {
        const prompt = buildNegotiationInstructions(context(), true, "text", { feedbackRecorded: false });

        expect(prompt).toMatch(/CHECK-IN FIRST/);
        expect(prompt).toMatch(/record_feedback/);
    });

    it("only tells the agent to say a repair was passed on when the tenant raised one", () => {
        const prompt = buildNegotiationInstructions(context(), true, "text", { feedbackRecorded: false });

        expect(prompt).not.toMatch(/After record_feedback, say a new repair has been passed/);
        expect(prompt).toMatch(/only if they raised a repair/);
    });

    it("drops the check-in rule once feedback is recorded", () => {
        const prompt = buildNegotiationInstructions(context(), true, "text", { feedbackRecorded: true });

        expect(prompt).not.toMatch(/CHECK-IN FIRST/);
    });

    it("lists past maintenance requests with their status", () => {
        const prompt = buildNegotiationInstructions(
            context({
                maintenanceRequests: [
                    OPEN_TAP,
                    { ...OPEN_TAP, description: "Smoke alarm battery", status: "resolved", resolvedAt: "2026-09-01T00:00:00.000Z" },
                ],
            }),
            true,
            "text",
            { feedbackRecorded: false },
        );

        expect(prompt).toMatch(/Kitchen tap dripping \(open/);
        expect(prompt).toMatch(/Smoke alarm battery \(resolved/);
    });

    it("tells the handoff prompt about an urgent repair and to stay off what it cannot do", () => {
        const prompt = buildHandoffInstructions(context(), true, ["urgent_maintenance"], "voice");

        expect(prompt).toMatch(/urgent repair/i);
        expect(prompt).toMatch(/today/);
        expect(prompt).toMatch(/Never say what you cannot do/);
    });
});
