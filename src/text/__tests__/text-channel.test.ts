/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCollectionVoiceAgent } from "@/voice/agent";
import { createInitialCallState, getDemoCallContext } from "@/voice/context";
import { buildHandoffInstructions, buildNegotiationInstructions, toTextReply } from "@/voice/instructions";
import { fulfilAcceptedPlan } from "@/voice/fulfil-plan";
import { getCollectionTools } from "@/voice/tools";

const EXEC = { toolCallId: "t1", messages: [], context: {} };

/** State after the check-in, so the policy and payment tools are unlocked. */
function checkedInState() {
    return { ...createInitialCallState(), feedbackRecorded: true };
}

vi.mock("@/voice/fulfil-plan", () => ({ fulfilAcceptedPlan: vi.fn() }));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-03T18:00:00Z"));
});

afterEach(() => {
    vi.useRealTimers();
});

describe("text-channel instructions", () => {
    it("write money and dates for a phone screen instead of speech", () => {
        const ctx = getDemoCallContext();
        const text = buildNegotiationInstructions(ctx, false, "text");

        expect(text).toContain("$1,840");
        expect(text).toContain("Fri Oct 9");
        expect(text).toContain("text message");
        expect(text).not.toContain("eighteen hundred forty dollars");
        expect(text).not.toContain("spoken aloud");
    });

    it("disclose the AI only in the first message of a thread", () => {
        const ctx = getDemoCallContext();

        expect(buildNegotiationInstructions(ctx, false, "text")).toMatch(/first message.*AI assistant/i);
        expect(buildNegotiationInstructions(ctx, true, "text")).toMatch(/already introduced yourself/);
    });

    it("keep the voice prompt as the default", () => {
        const ctx = getDemoCallContext();
        const voice = buildNegotiationInstructions(ctx, false);

        expect(buildNegotiationInstructions(ctx, false, "voice")).toBe(voice);
        expect(voice).toContain("eighteen hundred forty dollars");
        expect(voice).toContain("spoken aloud");
        expect(buildHandoffInstructions(ctx, true, [], "text")).not.toBe(buildHandoffInstructions(ctx, true, []));
    });
});

describe("toTextReply", () => {
    it("keeps links and digits, tidies amounts and dates, and drops markdown", () => {
        expect(toTextReply("**Pay $920.00** on 2026-10-09:\nhttps://checkout.stripe.com/c/pay/cs_test_a1_b2#fid__x and _thanks_"))
            .toBe("Pay $920 on Fri Oct 9: https://checkout.stripe.com/c/pay/cs_test_a1_b2#fid__x and thanks");
    });
});

describe("createCollectionVoiceAgent channel", () => {
    it("defaults to voice with the spoken disclosure line", () => {
        const agent = createCollectionVoiceAgent({ context: getDemoCallContext(), state: createInitialCallState() });

        expect(agent.channel).toBe("voice");
        expect(agent.disclosureLine).toBe("Hi, I'm an AI assistant calling for Maple Court.");
        expect(agent.formatReply("$1,840 due 2026-10-09")).toBe("eighteen hundred forty dollars due Friday, October ninth");
    });

    it("formats text replies for SMS", () => {
        const agent = createCollectionVoiceAgent({
            context: getDemoCallContext(),
            state: createInitialCallState(),
            channel: "text",
        });

        expect(agent.channel).toBe("text");
        expect(agent.disclosureLine).toBe("Hi, this is an AI assistant for Maple Court.");
        expect(agent.formatReply("$1,840 due 2026-10-09")).toBe("$1,840 due Fri Oct 9");
    });
});

describe("accept_plan on text", () => {
    const plan = { installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-09", amount: 920 }] };

    it("waits for the Stripe link, emails it, and puts it in the reply", async () => {
        vi.mocked(fulfilAcceptedPlan).mockResolvedValue({
            url: "https://checkout.stripe.com/c/pay/cs_test_1",
            source: "checkout_session",
            messages: {
                sms: { status: "skipped", reason: "sms not requested" },
                email: { status: "sent", id: "em_1" },
                anySent: true,
            },
        });
        const state = checkedInState();
        const tools = getCollectionTools(getDemoCallContext(), state, { channel: "text" });

        const result = await tools.accept_plan.execute?.(plan, EXEC);

        expect(fulfilAcceptedPlan).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ installments: plan.installments }),
            expect.anything(),
            { channels: ["email"] },
        );
        expect(result).toEqual({
            status: "saved",
            say: "You're all set: $920 today and $920 on Fri Oct 9. Pay the first $920 here: "
                + "https://checkout.stripe.com/c/pay/cs_test_1 I emailed it to you too.",
        });
        expect(state.paymentLinkUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    });

    it("on voice still messages both channels in the background", async () => {
        vi.mocked(fulfilAcceptedPlan).mockReturnValue(new Promise(() => undefined));
        const tools = getCollectionTools(getDemoCallContext(), checkedInState());

        const result = await tools.accept_plan.execute?.(plan, EXEC);

        expect(vi.mocked(fulfilAcceptedPlan).mock.calls.at(-1)).toHaveLength(3);
        expect(result).toMatchObject({ status: "saved" });
    });
});

describe("check_policy on text", () => {
    it("states the counter-offer with digits", async () => {
        const tools = getCollectionTools(getDemoCallContext(), checkedInState(), { channel: "text" });
        const result = await tools.check_policy.execute?.(
            { installments: [{ date: "2026-10-03", amount: 1000 }, { date: "2026-10-09", amount: 1000 }] },
            EXEC,
        );

        expect(result).toMatchObject({
            status: "counter",
            say: "The installments need to add up to $1,840. I can do $920 today and $920 on Mon Oct 12. Does that work?",
        });
    });
});
