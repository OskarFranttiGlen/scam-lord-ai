/**
 * @module collection/policy
 *
 * Numeric landlord policy enforcement for payment plans (ScamLord SPEC).
 *
 * Depends on: ./types
 * Used by: @/voice/tools, collection index
 */

import type {
    TPaymentPlan,
    TPerk,
    TPolicy,
    TPolicyResult,
    TPerkCondition,
} from "./types";

export type TCheckPolicyContext = {
    openBalance: number;
    policy: TPolicy;
    perks: TPerk[];
    /** Used for grace-period window checks (YYYY-MM-DD). */
    invoiceDueDate: string;
    /** Reference date for grace window (defaults to today UTC). */
    asOfDate?: string;
};

function parseUtcDate(isoDate: string): Date {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function addDaysUtc(date: Date, days: number): Date {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

/**
 * What the installments must cover: a fee waiver comes off the open balance.
 *
 * @param openBalance - Open invoice balance in dollars
 * @param feeWaiver - Waived fees in dollars
 */
export function amountOwed(openBalance: number, feeWaiver: number): number {
    return Math.round((openBalance - feeWaiver) * 100) / 100;
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

function perkConditionMet(
    condition: TPerkCondition,
    plan: TPaymentPlan,
    openBalance: number,
    asOf: string,
): boolean {
    if (condition.type === "pay_in_full_today") {
        return plan.installments.length === 1
            && plan.installments[0].date === asOf
            && Math.abs(plan.installments[0].amount - openBalance) < 0.01;
    }
    return false;
}

function counterPlan(
    ctx: TCheckPolicyContext,
    partial: Partial<TPaymentPlan>,
): TPaymentPlan {
    const count = Math.min(
        partial.installments?.length ?? ctx.policy.maxInstallments,
        ctx.policy.maxInstallments,
    );
    const asOf = ctx.asOfDate ?? todayUtc();
    const due = parseUtcDate(ctx.invoiceDueDate);
    const lastAllowed = addDaysUtc(due, ctx.policy.graceDays);
    const lastDate = lastAllowed.toISOString().slice(0, 10);
    const firstDate = asOf > ctx.invoiceDueDate ? asOf : ctx.invoiceDueDate;

    const feeWaiver = Math.min(partial.feeWaiver ?? 0, ctx.policy.feeWaiverCap);
    const totalCents = Math.round(amountOwed(ctx.openBalance, feeWaiver) * 100);
    const eachCents = Math.floor(totalCents / Math.max(count, 1));
    const installments = Array.from({ length: count }, (_, i) => {
        const isLast = i === count - 1;
        return {
            date: isLast ? lastDate : firstDate,
            amount: (isLast ? totalCents - eachCents * (count - 1) : eachCents) / 100,
        };
    });

    return {
        installments,
        feeWaiver,
        perkId: partial.perkId ?? null,
    };
}

/**
 * Accepts a proposed plan or returns the nearest in-policy counter-offer.
 *
 * @param ctx - Open balance, policy, perks, and due date
 * @param proposed - Tenant-negotiated schedule
 */
export function checkPolicy(ctx: TCheckPolicyContext, proposed: TPaymentPlan): TPolicyResult {
    const waiver = proposed.feeWaiver ?? 0;
    const asOf = ctx.asOfDate ?? todayUtc();

    if (proposed.installments.length > ctx.policy.maxInstallments) {
        const plan = counterPlan(ctx, { feeWaiver: waiver, perkId: proposed.perkId });
        return {
            status: "counter",
            plan,
            message: `I can split this into ${ctx.policy.maxInstallments} payments instead. `
                + `How about ${plan.installments.map(r => `$${r.amount.toFixed(2)} on ${r.date}`).join(" and ")}?`,
        };
    }

    if (waiver > ctx.policy.feeWaiverCap) {
        const capped = checkPolicy(ctx, { ...proposed, feeWaiver: ctx.policy.feeWaiverCap });
        const plan = capped.plan;
        const capMsg = ctx.policy.feeWaiverCap === 0
            ? "I cannot waive fees on this account."
            : `The most I can waive in fees is $${ctx.policy.feeWaiverCap.toFixed(2)}.`;
        return { status: "counter", plan, message: capMsg };
    }

    const due = parseUtcDate(ctx.invoiceDueDate);
    const lastAllowed = addDaysUtc(due, ctx.policy.graceDays);
    const lastAllowedStr = lastAllowed.toISOString().slice(0, 10);

    for (const row of proposed.installments) {
        const promised = parseUtcDate(row.date);
        if (promised > lastAllowed || row.date < asOf) {
            const plan = counterPlan(ctx, { feeWaiver: waiver, perkId: proposed.perkId });
            return {
                status: "counter",
                plan,
                message: `I need dates between today and ${lastAllowedStr}. `
                    + `The latest I can offer is ${plan.installments[plan.installments.length - 1].date}.`,
            };
        }
    }

    const total = proposed.installments.reduce((sum, row) => sum + row.amount, 0);
    const owed = amountOwed(ctx.openBalance, waiver);
    if (Math.abs(total - owed) > 0.01) {
        const plan = counterPlan(ctx, { feeWaiver: waiver, perkId: proposed.perkId });
        return {
            status: "counter",
            plan,
            message: `The installments need to add up to $${owed.toFixed(2)}.`,
        };
    }

    if (proposed.perkId) {
        const perk = ctx.perks.find(p => p.id === proposed.perkId);
        if (!perk) {
            return {
                status: "counter",
                plan: { ...proposed, perkId: null },
                message: "That perk is not available on this account.",
            };
        }
        if (!perkConditionMet(perk.condition, proposed, owed, asOf)) {
            return {
                status: "counter",
                plan: { ...proposed, perkId: null },
                message: "That perk only applies once the plan meets its condition.",
            };
        }
    }

    const schedule = proposed.installments
        .map(row => `$${row.amount.toFixed(2)} on ${row.date}`)
        .join(", ");

    let message = `That works: ${schedule}.`;
    if (proposed.perkId) {
        const perk = ctx.perks.find(p => p.id === proposed.perkId);
        if (perk) {
            message += ` If you keep to this plan, ${perk.text}`;
        }
    }

    return {
        status: "accepted",
        plan: proposed,
        message,
    };
}
