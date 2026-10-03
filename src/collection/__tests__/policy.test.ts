/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkPolicy, type TCheckPolicyContext } from "@/collection/policy";
import type { TPaymentPlan } from "@/collection/types";

const TODAY = "2026-10-03";

/** Demo tenancy: $1,840 open, due 2026-09-28, last allowed date 2026-10-12. */
const CTX: TCheckPolicyContext = {
    openBalance: 1840,
    policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 75 },
    perks: [
        {
            id: "perk_mow",
            text: "we will mow the lawn this weekend.",
            condition: { type: "pay_in_full_today" },
        },
    ],
    invoiceDueDate: "2026-09-28",
    asOfDate: TODAY,
};

/**
 * Builds a plan from `[date, amount]` rows.
 *
 * @param rows - installment date and amount pairs
 * @param extra - fee waiver / perk overrides
 */
function plan(rows: Array<[string, number]>, extra: Partial<TPaymentPlan> = {}): TPaymentPlan {
    return {
        installments: rows.map(([date, amount]) => ({ date, amount })),
        feeWaiver: 0,
        perkId: null,
        ...extra,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("checkPolicy — accepted plans", () => {
    it("accepts a two-installment plan inside the grace window that sums to the balance", () => {
        const proposed = plan([["2026-10-03", 920], ["2026-10-12", 920]]);
        const result = checkPolicy(CTX, proposed);

        expect(result.status).toBe("accepted");
        expect(result.plan).toEqual(proposed);
        expect(result.message).toBe("That works: $920.00 on 2026-10-03, $920.00 on 2026-10-12.");
    });

    it("accepts the last grace day itself (due date + graceDays is inclusive)", () => {
        expect(checkPolicy(CTX, plan([["2026-10-12", 1840]])).status).toBe("accepted");
    });
});

describe("checkPolicy — fee waiver reduces what is owed", () => {
    it("accepts installments that sum to the balance minus the waiver", () => {
        const result = checkPolicy(CTX, plan([["2026-10-03", 900], ["2026-10-12", 865]], { feeWaiver: 75 }));

        expect(result.status).toBe("accepted");
    });

    it("counters installments that ignore the waiver, splitting the reduced balance", () => {
        const result = checkPolicy(CTX, plan([["2026-10-03", 920], ["2026-10-12", 920]], { feeWaiver: 75 }));

        expect(result.status).toBe("counter");
        const total = result.plan.installments.reduce((sum, r) => sum + r.amount, 0);
        expect(total).toBeCloseTo(1765, 2);
        expect(checkPolicy(CTX, result.plan).status).toBe("accepted");
    });
});

describe("checkPolicy — counter-offers are themselves in policy", () => {
    it.each([
        ["too many installments", plan([["2026-10-05", 613.33], ["2026-10-08", 613.33], ["2026-10-12", 613.34]])],
        ["date past grace", plan([["2026-10-03", 920], ["2026-10-13", 920]])],
        ["wrong total", plan([["2026-10-03", 500], ["2026-10-12", 500]])],
    ])("re-checking the counter for %s is accepted", (_label, proposed) => {
        const counter = checkPolicy(CTX, proposed);

        expect(counter.status).toBe("counter");
        expect(counter.plan.installments.every(r => r.date >= TODAY)).toBe(true);
        expect(checkPolicy(CTX, counter.plan).status).toBe("accepted");
    });

    it("caps an over-cap waiver and returns a counter that is itself in policy", () => {
        const proposed = plan([["2026-10-04", 1000], ["2026-10-10", 640]], { feeWaiver: 200 });
        const result = checkPolicy(CTX, proposed);

        expect(result.status).toBe("counter");
        expect(result.plan.feeWaiver).toBe(75);
        expect(checkPolicy(CTX, result.plan).status).toBe("accepted");
    });

    it("splits an uneven balance so the counter still sums to it", () => {
        const ctx = { ...CTX, openBalance: 1000, policy: { ...CTX.policy, maxInstallments: 3 } };
        const result = checkPolicy(ctx, plan([
            ["2026-10-04", 250], ["2026-10-05", 250], ["2026-10-06", 250], ["2026-10-07", 250],
        ]));

        const total = result.plan.installments.reduce((sum, r) => sum + r.amount, 0);
        expect(total).toBeCloseTo(1000, 2);
    });

    it("judges the pay-in-full-today perk against asOfDate, not the wall clock", () => {
        vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
        const result = checkPolicy(CTX, plan([[TODAY, 1840]], { perkId: "perk_mow" }));

        expect(result.status).toBe("accepted");
    });
});

describe("checkPolicy — counter-offers", () => {
    it("counters too many installments with an even split at maxInstallments", () => {
        const result = checkPolicy(
            CTX,
            plan([["2026-10-05", 613.33], ["2026-10-08", 613.33], ["2026-10-12", 613.34]]),
        );

        expect(result.status).toBe("counter");
        expect(result.plan.installments).toHaveLength(2);
        expect(result.plan.installments.map(r => r.amount)).toEqual([920, 920]);
        expect(result.plan.installments[1].date).toBe("2026-10-12");
        expect(result.message).toContain("2 payments");
    });

    it("caps an over-cap fee waiver at feeWaiverCap", () => {
        const result = checkPolicy(CTX, plan([["2026-10-03", 1840]], { feeWaiver: 200 }));

        expect(result.status).toBe("counter");
        expect(result.plan.feeWaiver).toBe(75);
        expect(result.message).toBe("The most I can waive in fees is $75.00.");
    });

    it("says no waiver is possible when the cap is zero", () => {
        const ctx = { ...CTX, policy: { ...CTX.policy, feeWaiverCap: 0 } };
        const result = checkPolicy(ctx, plan([["2026-10-03", 1840]], { feeWaiver: 10 }));

        expect(result.status).toBe("counter");
        expect(result.plan.feeWaiver).toBe(0);
        expect(result.message).toBe("I cannot waive fees on this account.");
    });

    it("reports the installment counter first when a plan breaks several rules", () => {
        const result = checkPolicy(
            CTX,
            plan([["2026-11-01", 600], ["2026-12-01", 600], ["2027-01-01", 640]], { feeWaiver: 500 }),
        );

        expect(result.status).toBe("counter");
        expect(result.plan.installments).toHaveLength(2);
        expect(result.plan.feeWaiver).toBe(75);
        expect(result.message).toContain("2 payments");
    });

    it("counters a date past the grace window with the last allowed date", () => {
        const result = checkPolicy(CTX, plan([["2026-10-03", 920], ["2026-10-13", 920]]));

        expect(result.status).toBe("counter");
        expect(result.plan.installments.at(-1)?.date).toBe("2026-10-12");
        expect(result.message).toContain("2026-10-12");
    });

    it("counters a date before asOfDate", () => {
        const result = checkPolicy(CTX, plan([["2026-10-02", 1840]]));

        expect(result.status).toBe("counter");
        expect(result.message).toContain("between today and 2026-10-12");
    });

    it("counters installments that do not add up to the open balance", () => {
        const result = checkPolicy(CTX, plan([["2026-10-03", 500], ["2026-10-12", 500]]));

        expect(result.status).toBe("counter");
        expect(result.message).toBe("The installments need to add up to $1840.00.");
        const total = result.plan.installments.reduce((sum, r) => sum + r.amount, 0);
        expect(total).toBe(1840);
    });

    it("tolerates a sub-cent rounding difference in the total", () => {
        expect(checkPolicy(CTX, plan([["2026-10-03", 920.004], ["2026-10-12", 919.999]])).status)
            .toBe("accepted");
    });
});

describe("checkPolicy — perks", () => {
    it("accepts the pay-in-full-today perk and appends its text", () => {
        const result = checkPolicy(CTX, plan([[TODAY, 1840]], { perkId: "perk_mow" }));

        expect(result.status).toBe("accepted");
        expect(result.plan.perkId).toBe("perk_mow");
        expect(result.message).toContain("we will mow the lawn this weekend.");
    });

    it("strips the perk when the plan is split", () => {
        const proposed = plan([[TODAY, 920], ["2026-10-12", 920]], { perkId: "perk_mow" });
        const result = checkPolicy(CTX, proposed);

        expect(result.status).toBe("counter");
        expect(result.plan).toEqual({ ...proposed, perkId: null });
        expect(result.message).toBe("That perk only applies once the plan meets its condition.");
    });

    it("strips the perk when the single payment is not today", () => {
        const result = checkPolicy(CTX, plan([["2026-10-05", 1840]], { perkId: "perk_mow" }));

        expect(result.status).toBe("counter");
        expect(result.plan.perkId).toBeNull();
    });

    it("rejects an unknown perk id", () => {
        const result = checkPolicy(CTX, plan([[TODAY, 1840]], { perkId: "perk_free_month" }));

        expect(result.status).toBe("counter");
        expect(result.plan.perkId).toBeNull();
        expect(result.message).toBe("That perk is not available on this account.");
    });
});
