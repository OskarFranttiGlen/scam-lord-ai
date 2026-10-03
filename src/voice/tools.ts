/**
 * @module voice/tools
 *
 * Vercel AI SDK tools for the collection voice **ToolLoopAgent**. Signal evaluation is
 * not a tool: {@link runVoiceTurn} starts Jev before generation and side-effect tools
 * wait on that in-flight check through the {@link TSignalGate}.
 *
 * Depends on: ai, zod, @/collection/policy, @/collection/types, @/payments/stripe, ./context,
 * ./fulfil-plan, ./instructions
 * Used by: @/voice/agent.ts
 */

import { tool } from "ai";
import { z } from "zod";

import { checkPolicy } from "@/collection/policy";
import type { TPaymentPlan, TPerk, TPolicy, TPolicyResult, TSignalDecision } from "@/collection/types";
import { sendSms } from "@/messaging/sms";
import { getInvoicePaymentStatus, getStripeClient } from "@/payments/stripe";
import type { CallContext, CallState, TAcceptedPlan, TCallPerk } from "./context";
import { fulfilAcceptedPlan, type TFulfilOptions } from "./fulfil-plan";
import {
    spokenDollars,
    spokenDate,
    textDate,
    textDollars,
    todayIsoDate,
    toSpokenText,
    toTextReply,
    type TConversationChannel,
} from "./instructions";

const installmentSchema = z.object({
    date: z.string().describe("Payment date in YYYY-MM-DD from the allowed dates list"),
    amount: z.number().positive().describe("Dollar amount for this installment"),
});

const planInputSchema = z.object({
    installments: z.array(installmentSchema).min(1),
    feeWaiver: z.number().min(0).optional().describe("Fee waiver in dollars, if the tenant asked for one"),
    perkId: z.string().optional().describe("Perk id, only when paying the full balance today"),
});

const feedbackInputSchema = z.object({
    summary: z.string().describe("One short line on what the tenant said about the unit; empty if they declined"),
    declined: z.boolean().describe("True when the tenant did not want to give feedback"),
    issues: z.array(z.object({
        description: z.string().describe("The repair in a few words, e.g. \"Kitchen tap still dripping\""),
        urgent: z.boolean().describe(
            "No heat, no hot or running water, an active leak or flooding, mould, a gas smell, an electrical "
            + "hazard, a broken lock or door, or anything unsafe",
        ),
    })).describe("Each repair or maintenance problem they raised, including an old one that is still not fixed"),
});

/** Returned by policy and payment tools until the check-in has been recorded. */
const CHECK_IN_FIRST = {
    status: "check_in_first",
    say: "Not yet: first ask how things are going with the unit and whether anything needs fixing, "
        + "then call record_feedback with their answer.",
} as const;

const pendingFulfilments = new WeakMap<CallState, Promise<void>>();

function trackFulfilment(state: CallState, task: Promise<void>): void {
    pendingFulfilments.set(state, task);
}

/**
 * Resolves once the background Stripe + messaging step for this call has finished.
 *
 * @param state - Call state the plan was accepted on
 */
export async function waitForFulfilment(state: CallState): Promise<void> {
    await pendingFulfilments.get(state);
}

/** In-flight signal check for the current turn; side-effect tools await it. */
export type TSignalGate = {
    pending: Promise<TSignalDecision> | null;
};

export type TCollectionToolsDeps = {
    log?: Pick<Console, "log" | "info" | "warn">;
    onStateChange?: (state: CallState) => void;
    signalGate?: TSignalGate;
    /** `voice` (default) or `text`; picks wording and how the payment link reaches the tenant. */
    channel?: TConversationChannel;
};

/** How long a text reply waits for the Stripe link; Twilio drops the webhook at 15 s. */
const TEXT_LINK_WAIT_MS = 8000;

function toPolicy(ctx: CallContext): TPolicy {
    return {
        maxInstallments: ctx.policy.maxInstallments,
        graceDays: ctx.policy.graceDays,
        feeWaiverCap: ctx.policy.feeWaiverCap,
    };
}

function toPerks(ctx: CallContext): TPerk[] {
    return ctx.perks.map(p => ({
        id: p.id,
        text: p.description,
        condition: { type: "pay_in_full_today" as const },
    }));
}

function runPolicy(ctx: CallContext, plan: z.infer<typeof planInputSchema>): TPolicyResult {
    const proposed: TPaymentPlan = {
        installments: plan.installments,
        feeWaiver: plan.feeWaiver ?? 0,
        perkId: plan.perkId ?? null,
    };
    return checkPolicy(
        {
            openBalance: ctx.openBalance,
            policy: toPolicy(ctx),
            perks: toPerks(ctx),
            invoiceDueDate: ctx.invoiceDueDate,
        },
        proposed,
    );
}

function spokenSchedule(plan: TPaymentPlan, today: string, channel: TConversationChannel = "voice"): string {
    const dollars = channel === "voice" ? spokenDollars : textDollars;
    const date = channel === "voice" ? spokenDate : textDate;
    return plan.installments
        .map(row => `${dollars(row.amount)} ${row.date === today ? "today" : `on ${date(row.date)}`}`)
        .join(" and ");
}

/**
 * Resolves with the promise's value, or `null` once `ms` passes first.
 *
 * @param promise - Work to wait on
 * @param ms - Time budget in milliseconds
 */
async function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Policy counter-offers may schedule a payment on the (already past) invoice due date;
 * moving those rows to today keeps the offer acceptable on the next turn.
 */
function clampPastDates(plan: TPaymentPlan, today: string): TPaymentPlan {
    return {
        ...plan,
        installments: plan.installments.map(row => (row.date < today ? { ...row, date: today } : row)),
    };
}

function describePolicyResult(
    result: TPolicyResult,
    channel: TConversationChannel = "voice",
): { status: TPolicyResult["status"]; say: string; plan: TPaymentPlan } {
    const today = todayIsoDate();
    const plan = result.status === "counter" ? clampPastDates(result.plan, today) : result.plan;
    const schedule = spokenSchedule(plan, today, channel);
    const message = channel === "voice" ? toSpokenText(result.message) : toTextReply(result.message);
    return {
        status: result.status,
        say: result.status === "accepted"
            ? `That works: ${schedule}.`
            : `${message} Suggested plan: ${schedule}.`,
        plan,
    };
}

/**
 * Builds the tool registry for one conversation's turn loop (phone call or text thread).
 *
 * @param ctx - Tenancy and invoice snapshot
 * @param state - Mutable call state (transcript, Jev, plan, link flags)
 * @param deps - Optional logger, state change callback, signal gate, and channel
 */
export function getCollectionTools(
    ctx: CallContext,
    state: CallState,
    deps: TCollectionToolsDeps = {},
) {
    const log = deps.log ?? console;
    const channel = deps.channel ?? "voice";

    const recordFeedbackTool = tool({
        description: "Record the tenant's check-in answer (or that they declined) and any repairs they raised. "
            + "Required before check_policy or accept_plan.",
        inputSchema: feedbackInputSchema,
        execute: async ({ summary, declined, issues }) => {
            const line = declined ? "declined" : summary.trim() || "no issues";
            state.tenantFeedback = state.feedbackRecorded && state.tenantFeedback && !declined
                ? `${state.tenantFeedback}; ${line}`
                : state.tenantFeedback ?? line;
            state.feedbackRecorded = true;
            state.maintenanceReports.push(...issues.map(issue => ({
                id: crypto.randomUUID(),
                description: issue.description.trim(),
                urgent: issue.urgent,
            })));
            if (issues.some(issue => issue.urgent)) {
                state.urgentMaintenance = true;
                state.handoffActive = true;
            }
            deps.onStateChange?.(state);

            if (state.urgentMaintenance) {
                return {
                    status: "urgent_handoff",
                    next: `Logged as urgent. Tell them someone from ${ctx.propertyName} will contact them today about it. `
                        + "Do not bring up the balance.",
                };
            }
            return {
                status: "recorded",
                next: issues.length
                    ? "Logged for the property team. Say it has been passed on (no dates), then move on to the balance."
                    : "Thank them, then move on to the balance.",
            };
        },
    });

    const checkPolicyTool = tool({
        description: "Check a proposed payment plan against landlord policy before you state it",
        inputSchema: planInputSchema,
        execute: async plan => (
            state.feedbackRecorded ? describePolicyResult(runPolicy(ctx, plan), channel) : CHECK_IN_FIRST
        ),
    });

    /**
     * Text thread: the tenant is already reading this SMS thread, so wait for the Stripe link
     * and put it in the reply; only email goes out separately. If Stripe is slow, the link
     * follows by SMS as well once it exists.
     */
    const fulfilOnText = async (accepted: TAcceptedPlan, perk: TCallPerk | undefined) => {
        const delivery: TFulfilOptions = { channels: ["email"] };
        const fulfilment = fulfilAcceptedPlan(ctx, accepted, log, delivery).then(result => {
            state.paymentLinkUrl = result.url ?? undefined;
            state.paymentInvoiceId = result.payInvoiceId;
            deps.onStateChange?.(state);
            return result;
        });
        trackFulfilment(state, fulfilment.then(() => undefined));

        const schedule = spokenSchedule({ ...accepted, feeWaiver: accepted.feeWaiver ?? 0 }, todayIsoDate(), "text");
        const thanks = perk ? ` As a thank you: ${perk.description}` : "";
        const settled = await withinMs(fulfilment, TEXT_LINK_WAIT_MS);
        if (!settled) {
            delivery.channels = ["sms", "email"];
            return `You're all set: ${schedule}. Your secure payment link will be texted here in a moment.${thanks}`;
        }
        if (!settled.url) {
            return `You're all set: ${schedule}. Someone from ${ctx.propertyName} will send your payment link shortly.`
                + thanks;
        }
        const emailed = settled.messages?.email.status === "sent" ? " I emailed it to you too." : "";
        return `You're all set: ${schedule}. Pay the first ${textDollars(accepted.installments[0].amount)} here: `
            + `${settled.url}${emailed}${thanks}`;
    };

    const acceptPlanTool = tool({
        description: channel === "voice"
            ? "Tenant agreed to an in-policy plan: save it and text and email the secure payment link"
            : "Tenant agreed to an in-policy plan: save it, email the secure payment link, and reply with the link",
        inputSchema: planInputSchema,
        execute: async plan => {
            await deps.signalGate?.pending;
            if (!state.feedbackRecorded) {
                return CHECK_IN_FIRST;
            }
            if (state.handoffActive) {
                return {
                    status: "handoff",
                    say: `Thanks for bearing with me. Someone from ${ctx.propertyName} will follow up with you personally.`,
                };
            }

            const result = runPolicy(ctx, plan);
            if (result.status !== "accepted") {
                const counter = describePolicyResult(result, channel);
                return { ...counter, say: `${counter.say} Would that work for you?` };
            }

            const accepted: TAcceptedPlan = {
                installments: result.plan.installments,
                feeWaiver: plan.feeWaiver,
                perkId: plan.perkId,
            };
            state.acceptedPlan = accepted;
            state.paymentLinkSent = true;
            deps.onStateChange?.(state);
            const perk = plan.perkId ? ctx.perks.find(p => p.id === plan.perkId) : undefined;

            if (channel === "text") {
                return { status: "saved", say: await fulfilOnText(accepted, perk) };
            }

            trackFulfilment(state, fulfilAcceptedPlan(ctx, accepted, log).then(fulfilment => {
                state.paymentLinkUrl = fulfilment.url ?? undefined;
                state.paymentInvoiceId = fulfilment.payInvoiceId;
                deps.onStateChange?.(state);
            }));

            return {
                status: "saved",
                say: `You're all set for ${spokenSchedule(result.plan, todayIsoDate())}, `
                    + "and the secure payment link is on its way by text and email."
                    + (perk ? ` As a thank you, ${perk.description}.` : ""),
            };
        },
    });

    const sendAssistanceReferralTool = tool({
        description: "Text San Francisco ERAP details (sf.gov/renthelp and the helpline). Use in hardship or distress playbooks.",
        inputSchema: z.object({}),
        execute: async () => {
            const phone = process.env.DEMO_TENANT_PHONE?.trim() || ctx.phone;
            const body = "San Francisco ERAP may help with past-due rent paid to your property. "
                + "Apply at sf.gov/renthelp or call (415) 653-5744. Funding is limited; approval is not guaranteed.";
            try {
                await sendSms({ to: phone, body });
                return { status: "sent", say: "I've texted you the city rental assistance link and helpline." };
            } catch (error) {
                log.warn("[voice] send_assistance_referral failed", error);
                return { status: "failed", say: "I couldn't text the link just now; try sf.gov/renthelp or call four one five, six five three, five seven four four." };
            }
        },
    });

    const recordClosingFeedbackTool = tool({
        description: "Record the closing satisfaction score (1–5) and optional comment before ending the call.",
        inputSchema: z.object({
            score: z.number().int().min(1).max(5),
            comment: z.string().optional(),
        }),
        execute: async ({ score, comment }) => {
            state.satisfactionScore = score;
            if (comment?.trim()) {
                state.tenantFeedback = state.tenantFeedback
                    ? `${state.tenantFeedback}; closing: ${comment.trim()}`
                    : `closing: ${comment.trim()}`;
            }
            deps.onStateChange?.(state);
            return {
                status: "recorded",
                say: score <= 2
                    ? "Thank you for being straight with me. I'm passing that to the property manager."
                    : "Glad to hear it. Thanks for your time.",
            };
        },
    });

    const confirmPaymentTool = tool({
        description: "Check whether the payment for this invoice has gone through",
        inputSchema: z.object({}),
        execute: async () => {
            await waitForFulfilment(state);
            const stripe = getStripeClient();
            const invoiceId = state.paymentInvoiceId ?? ctx.stripeInvoiceId;
            if (!stripe) {
                return "Payment is still pending.";
            }
            try {
                const status = await getInvoicePaymentStatus({ stripe, invoiceId });
                return status.paid ? "Payment has gone through." : "Payment is still pending.";
            } catch (error) {
                log.warn("[voice] confirm_payment could not read Stripe", {
                    invoiceId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return "Payment is still pending.";
            }
        },
    });

    return {
        record_feedback: recordFeedbackTool,
        record_closing_feedback: recordClosingFeedbackTool,
        send_assistance_referral: sendAssistanceReferralTool,
        check_policy: checkPolicyTool,
        accept_plan: acceptPlanTool,
        confirm_payment: confirmPaymentTool,
    };
}
