/**
 * Demo-script behaviours: pin "soon" to a date, payday plan, half-yes, short link
 * confirmation, and the due-date-change office task. Fixtures spell out every value the
 * script depends on so they stay independent of the built-in demo tenancy.
 */
import { blocksPayment, OFFICE_TASK_TYPES, pausesCollection } from "@/collection/office-tasks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialCallState, getDemoCallContext, type CallContext } from "../context";
import { buildDueDateOffer, buildNegotiationInstructions, buildPlaybookInstructions } from "../instructions";
import { getCollectionTools } from "../tools";

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };

/** Script tenancy: John, twenty-four hundred dollars, October unpaid, paid on the 15th. */
function scriptContext(overrides: Partial<CallContext> = {}): CallContext {
    return {
        ...getDemoCallContext(),
        tenantName: "John Doe",
        propertyName: "Sunset Court",
        managerName: "Sunset Property Management",
        unitLabel: "Unit 4A",
        openBalance: 2400,
        invoiceDueDate: "2026-10-01",
        policy: { maxInstallments: 2, graceDays: 15, feeWaiverCap: 75 },
        perks: [{ id: "perk_mow", description: "we will mow the lawn this weekend", condition: "pay_open_balance_today" }],
        ledger: [
            { month: "2026-10", amount: 2400, status: "unpaid" },
            { month: "2026-09", amount: 2400, status: "late" },
            { month: "2026-08", amount: 2400, status: "late" },
        ],
        maintenanceRequests: [],
        ...overrides,
    };
}

describe("demo script rules in the negotiation prompt", () => {
    it("pins a vague promise to a date with the either/or cause question", () => {
        const prompt = buildNegotiationInstructions(scriptContext(), true, "voice");

        expect(prompt).toMatch(/PIN "SOON":/);
        expect(prompt).toContain(`Let's make 'soon' a date.`);
        expect(prompt).toContain("Is the money not there, or does it arrive at the wrong time of the month?");
        expect(prompt).toMatch(/never accept a vague promise/i);
    });

    it("offers half today and half the day after payday, inside the allowed dates", () => {
        const prompt = buildNegotiationInstructions(scriptContext(), true, "voice");

        expect(prompt).toMatch(/PAYDAY PLAN:/);
        expect(prompt).toMatch(/half today/i);
        expect(prompt).toMatch(/day after/i);
        expect(prompt).toMatch(/allowed dates/i);
    });

    it("says the actual installment limit when the tenant asks for more payments", () => {
        const prompt = buildNegotiationInstructions(scriptContext(), true, "voice");

        expect(prompt).toContain("Two is the most I can offer.");
    });

    it("words a higher installment limit correctly", () => {
        const ctx = scriptContext({ policy: { maxInstallments: 3, graceDays: 15, feeWaiverCap: 75 } });
        const prompt = buildNegotiationInstructions(ctx, true, "voice");

        expect(prompt).toContain("Three is the most I can offer.");
        expect(prompt).not.toContain("Two is the most I can offer.");
    });

    it("treats a hedged OK as not agreement and asks for a clear yes", () => {
        const prompt = buildNegotiationInstructions(scriptContext(), true, "voice");

        expect(prompt).toMatch(/HALF-YES:/);
        expect(prompt).toContain("Is that a yes? I'll send the link now.");
        expect(prompt).toMatch(/not agreement/i);
    });

    it("offers a due-date change once a payment is confirmed", () => {
        const prompt = buildNegotiationInstructions(scriptContext(), true, "voice");

        expect(prompt).toMatch(/DUE DATE CHANGE:/);
        expect(prompt).toContain(
            "Want me to ask Sunset Property Management to move your due date to the",
        );
        expect(prompt).toContain("so this stops happening?");
        expect(prompt).toContain("Done. Thanks, John.");
        expect(prompt).toMatch(/due_date_change/);
        expect(prompt).toMatch(/end_call/);
    });

    it("keeps the due-date rule in the playbook prompt", () => {
        const prompt = buildPlaybookInstructions(scriptContext(), true, "hardship", "voice");

        expect(prompt).toMatch(/DUE DATE CHANGE:/);
    });
});

describe("short link confirmation on voice", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T20:00:00.000Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("speaks only a short confirmation for a split plan", async () => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1200 }, { date: "2026-10-16", amount: 1200 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "saved", say: "It's on your phone." });
        expect(state.paymentLinkSent).toBe(true);
    });

    it("adds a short perk thanks when they pay in full today", async () => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 2400 }], perkId: "perk_mow" },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({
            status: "saved",
            say: "It's on your phone. As a thank you, we will mow the lawn this weekend.",
        });
    });

    it("saves the plan when the tenant's last line is a clear yes", async () => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        state.transcriptLines = [
            "Agent: Two is the most I can offer. Shall I set it up?",
            "Tenant: Yes.",
        ];
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1200 }, { date: "2026-10-16", amount: 1200 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "saved" });
    });
});

describe("accept_plan refuses a hedge", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-03T20:00:00.000Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("asks for a clear yes instead of saving when the last line is a hedge", async () => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        state.transcriptLines = [
            "Agent: That works: twelve hundred dollars today and twelve hundred dollars on Friday, October "
                + "sixteenth. Shall I set it up?",
            "Tenant: OK, I guess.",
        ];
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1200 }, { date: "2026-10-16", amount: 1200 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "confirm_first", say: "Is that a yes? I'll send the link now." });
        expect(state.acceptedPlan).toBeUndefined();
        expect(state.paymentLinkSent).toBe(false);
    });

    it.each([
        "Is there any chance I could do three payments?",
        "Could I do three payments?",
        "What if I paid on the twentieth?",
    ])("saves nothing when the last line is a question: %s", async (line) => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        state.transcriptLines = ["Agent: Shall I set it up?", `Tenant: ${line}`];
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1200 }, { date: "2026-10-16", amount: 1200 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "not_agreed" });
        expect(result).not.toHaveProperty("say");
        expect(state.acceptedPlan).toBeUndefined();
        expect(state.paymentLinkSent).toBe(false);
    });

    it.each([
        "OK, I guess.",
        "I suppose so.",
        "Maybe.",
        "Fine.",
        "OK",
    ])("refuses the hedge %s", async (line) => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        state.transcriptLines = [`Agent: Shall I set it up?`, `Tenant: ${line}`];
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1200 }, { date: "2026-10-16", amount: 1200 }] },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "confirm_first" });
    });

    it.each([
        "Yes.",
        "Yeah, let's do it.",
        "Sure, sounds good.",
        "I could pay all of it today.",
        "Could you send me the payment link?",
    ])("accepts the clear commitment %s", async (line) => {
        const state = { ...createInitialCallState(), feedbackRecorded: true };
        state.transcriptLines = [`Agent: Shall I set it up?`, `Tenant: ${line}`];
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.accept_plan.execute?.(
            { installments: [{ date: "2026-10-03", amount: 2400 }], perkId: "perk_mow" },
            TOOL_OPTIONS,
        );

        expect(result).not.toMatchObject({ status: "confirm_first" });
    });
});

describe("due_date_change office task", () => {
    it("is an office task type that keeps collection and payment running", () => {
        expect(OFFICE_TASK_TYPES).toContain("due_date_change");
        expect(pausesCollection("due_date_change")).toBe(false);
        expect(blocksPayment("due_date_change")).toBe(false);
    });

    it("opens through the create_office_task tool without pausing collection", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(scriptContext(), state);

        const result = await tools.create_office_task.execute?.(
            { type: "due_date_change", details: "Paid on the 15th; asked to move the rent due date to the 16th" },
            TOOL_OPTIONS,
        );

        expect(result).toMatchObject({ status: "opened" });
        expect(state.officeTasks[0]).toMatchObject({ type: "due_date_change", collectionPausedUntil: null });
    });
});

describe("buildDueDateOffer", () => {
    it("builds the spoken offer with the manager and the requested day", () => {
        expect(buildDueDateOffer(scriptContext(), "sixteenth")).toBe(
            "Want me to ask Sunset Property Management to move your due date to the sixteenth, "
            + "so this stops happening?",
        );
    });
});