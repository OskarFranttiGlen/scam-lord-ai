/**
 * Home panels derived from floor agents (ADR 0001 / 04). No Stripe.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { IAgent, IAgentOutcomes, TAgentStatus, TAgentStep } from "@/lib/agent-floor/agents";
import { activity, funnel, needsYou } from "@/lib/landlord-home/home-derived";

function agent(over: {
    id: string;
    tenant?: string;
    property?: string;
    status?: TAgentStatus;
    currentStep?: TAgentStep;
    outcomes?: IAgentOutcomes;
}): IAgent {
    return {
        id: over.id,
        tenant: over.tenant ?? "Blake Nguyen",
        property: over.property ?? "2 Cedar, Apt 1",
        status: over.status ?? "in_progress",
        currentStep: over.currentStep ?? "disclosure",
        invoice: { amount: 0, status: "", dueDate: "", hostedUrl: "" },
        schedule: { installments: 0, dates: [], amounts: [] },
        outcomes: over.outcomes ?? { callPlaced: false, planAccepted: false, paymentCleared: false },
        policy: { maxInstallments: 0, graceDays: 0, feeWaiverCap: 0 },
        perks: [],
        trace: { transcript: [], perkId: null, plan: "", jev: [] },
    };
}

describe("needsYou", () => {
    it("is empty when nobody is waiting on a person or handed off", () => {
        expect(needsYou([
            agent({ id: "a", status: "in_progress", currentStep: "jev" }),
            agent({ id: "b", status: "waiting_on_payment", currentStep: "payment_link" }),
        ])).toEqual([]);
    });

    it("lists a person-wait and a handoff, and prefers the handoff badge when both apply", () => {
        expect(needsYou([
            agent({ id: "wait", status: "waiting_on_person", currentStep: "jev" }),
            agent({ id: "pay", status: "waiting_on_payment", currentStep: "payment_link" }),
            agent({ id: "hand", status: "in_progress", currentStep: "handoff" }),
            agent({ id: "both", tenant: "Casey Diaz", property: "9 Alder", status: "waiting_on_person", currentStep: "handoff" }),
        ])).toEqual([
            { id: "wait", tenant: "Blake Nguyen", property: "2 Cedar, Apt 1", badge: "waiting" },
            { id: "hand", tenant: "Blake Nguyen", property: "2 Cedar, Apt 1", badge: "handoff" },
            { id: "both", tenant: "Casey Diaz", property: "9 Alder", badge: "handoff" },
        ]);
    });
});

describe("funnel", () => {
    it("is zeros when there are no calls", () => {
        expect(funnel([])).toEqual({ calls: 0, plans: 0, paid: 0 });
    });

    it("counts placed calls, accepted plans, and cleared payments", () => {
        expect(funnel([
            agent({ id: "1", outcomes: { callPlaced: true, planAccepted: true, paymentCleared: true } }),
            agent({ id: "2", outcomes: { callPlaced: true, planAccepted: true, paymentCleared: false } }),
            agent({ id: "3", outcomes: { callPlaced: false, planAccepted: false, paymentCleared: false } }),
        ])).toEqual({ calls: 2, plans: 2, paid: 1 });
    });
});

describe("activity", () => {
    it("is empty when there are no calls", () => {
        expect(activity([])).toEqual([]);
    });

    it("keeps call order and names the current step", () => {
        expect(activity([
            agent({ id: "new", tenant: "Casey Diaz", property: "9 Alder", currentStep: "paid" }),
            agent({ id: "old", currentStep: "plan" }),
        ])).toEqual([
            { id: "new", tenant: "Casey Diaz", property: "9 Alder", step: "paid" },
            { id: "old", tenant: "Blake Nguyen", property: "2 Cedar, Apt 1", step: "plan" },
        ]);
    });
});
