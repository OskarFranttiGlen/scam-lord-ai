/**
 * Call row → floor agent (ADR 0001 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { rowsToAgents, type ICallNest } from "../row-to-agent";

const CALL: ICallNest = {
    id: "call-1",
    status: "waiting_on_payment",
    current_step: "payment_link",
    transcript: "Agent: Two payments.\nBlake: Send the link.",
    jev_checks: [{
        probabilities: { hardship: 0.12, dispute: 0.04, distressed: 0.06 },
        outcome: { decision: "continue" },
    }],
    payment_link_sent: true,
    tenancies: {
        name: "Blake Nguyen",
        units: {
            label: "Apt 1",
            properties: {
                name: "2 Cedar",
                landlords: {
                    policies: { max_installments: 2, grace_days: 14, fee_waiver_cap: 0 },
                    perks: [{ id: "mow", body: "We'll mow the lawn.", condition_text: "pay today" }],
                },
            },
        },
    },
    plans: [{
        installment_count: 2,
        installment_dates: ["2026-10-03", "2026-10-17"],
        installment_amounts: [1200, 1200],
        perk_id: "mow",
    }],
};

describe("rowsToAgents", () => {
    it("maps a payment-wait call onto the floor agent", () => {
        expect(rowsToAgents([CALL])).toEqual([{
            id: "call-1",
            tenant: "Blake Nguyen",
            property: "2 Cedar, Apt 1",
            status: "waiting_on_payment",
            currentStep: "payment_link",
            invoice: { amount: 0, status: "", dueDate: "", hostedUrl: "" },
            schedule: {
                installments: 2,
                dates: ["2026-10-03", "2026-10-17"],
                amounts: [1200, 1200],
            },
            outcomes: { callPlaced: true, planAccepted: true, paymentCleared: false },
            policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 0 },
            perks: [{ id: "mow", text: "We'll mow the lawn.", condition: "pay today" }],
            trace: {
                transcript: ["Agent: Two payments.", "Blake: Send the link."],
                perkId: "mow",
                plan: "2 x 1200",
                jev: [{ hardship: 0.12, dispute: 0.04, distressed: 0.06, outcome: "continue" }],
            },
        }]);
    });

    it("returns no agents for an empty list", () => {
        expect(rowsToAgents([])).toEqual([]);
    });

    it("keeps paid and uses empty defaults when step, plan, and policy are missing", () => {
        const row: ICallNest = {
            ...CALL,
            status: "paid",
            current_step: null,
            transcript: null,
            jev_checks: [],
            payment_link_sent: false,
            tenancies: { name: "Casey Diaz", units: null },
            plans: [],
        };
        expect(rowsToAgents([row])[0]).toMatchObject({
            tenant: "Casey Diaz",
            property: "",
            status: "paid",
            currentStep: "invoice",
            outcomes: { callPlaced: false, planAccepted: false, paymentCleared: true },
            policy: { maxInstallments: 0, graceDays: 0, feeWaiverCap: 0 },
            schedule: { installments: 0, dates: [], amounts: [] },
            perks: [],
            trace: { transcript: [], perkId: null, plan: "", jev: [] },
        });
    });
});
