import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialCallState, type CallContext } from "../context";
import { getDemoCallContext } from "../demo-context";
import { getCollectionTools } from "../tools";

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };

function context(overrides: Partial<CallContext> = {}): CallContext {
    return { ...getDemoCallContext(), maintenanceRequests: [], ...overrides };
}

describe("create_office_task", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-03T20:00:00.000Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("opens a payment-matching task due tomorrow that pauses collection on this invoice", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state);

        const result = await tools.create_office_task.execute?.(
            { type: "payment_match", details: "Says paid by Zelle on Oct 1; receipt photo to follow" },
            TOOL_OPTIONS,
        );

        expect(state.officeTasks).toEqual([{
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            type: "payment_match",
            details: "Says paid by Zelle on Oct 1; receipt photo to follow",
            dueDate: "2026-10-04",
            collectionPausedUntil: "2026-10-04",
        }]);
        expect(result).toMatchObject({ status: "opened" });
    });

    it("opens a tenancy-at-risk task without pausing collection", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(context(), state);

        await tools.create_office_task.execute?.(
            { type: "tenancy_at_risk", details: "Fixed income, rent is a stretch" },
            TOOL_OPTIONS,
        );

        expect(state.officeTasks[0]).toMatchObject({ dueDate: "2026-10-04", collectionPausedUntil: null });
    });
});

describe("accept_plan with an open office task", () => {
    const TODAY_PLAN = { installments: [{ date: new Date().toISOString().slice(0, 10), amount: 2400 }] };

    it.each(["payment_match", "disputed_line"] as const)(
        "refuses while a %s task is open and sends no payment link",
        async (type) => {
            const state = createInitialCallState();
            state.feedbackRecorded = true;
            const tools = getCollectionTools(context(), state);
            await tools.create_office_task.execute?.({ type, details: "Being checked" }, TOOL_OPTIONS);

            const result = await tools.accept_plan.execute?.(TODAY_PLAN, TOOL_OPTIONS);

            expect(result).toMatchObject({ status: "office_check_pending" });
            expect(state.acceptedPlan).toBeUndefined();
            expect(state.paymentLinkSent).toBe(false);
        },
    );

    it("still lets a plan through when the open task does not block payment", async () => {
        const state = createInitialCallState();
        state.feedbackRecorded = true;
        const tools = getCollectionTools(context(), state);
        await tools.create_office_task.execute?.({ type: "lease_change", details: "Roommate moved out" }, TOOL_OPTIONS);

        const result = await tools.accept_plan.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(result).not.toMatchObject({ status: "office_check_pending" });
    });
});
