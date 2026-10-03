import { describe, expect, it } from "vitest";

import { buildLedgerLine, buildRentOpening, ledgerFromStripeInvoices } from "../call-opening";
import { createInitialCallState, type CallContext, type TLedgerMonth } from "../context";
import { getDemoCallContext } from "../demo-context";
import { buildNegotiationInstructions, buildPlaybookInstructions } from "../instructions";
import { buildOpeningGreeting } from "../livekit-agent";
import { getCollectionTools } from "../tools";

function context(overrides: Partial<CallContext> = {}): CallContext {
    return {
        ...getDemoCallContext(),
        managerName: "Maple Court Property Management",
        maintenanceRequests: [],
        ...overrides,
    };
}

const month = (m: string, status: TLedgerMonth["status"], amount = 1840): TLedgerMonth => ({ month: m, amount, status });

describe("buildOpeningGreeting", () => {
    it("asks for the tenant by first name and introduces itself as Mia from the manager, with no amount", () => {
        const greeting = buildOpeningGreeting(context());

        expect(greeting).toBe("Hi, is this Jordan? It's Mia from Maple Court Property Management.");
        expect(greeting).not.toMatch(/dollar|\d/i);
    });

    it("falls back to the property name when no manager name is known", () => {
        expect(buildOpeningGreeting(context({ managerName: undefined }))).toContain("Mia from Maple Court.");
    });
});

describe("buildLedgerLine", () => {
    it("names the two late months before an unpaid one (repeated late)", () => {
        const ledger = [month("2026-09", "unpaid"), month("2026-08", "late"), month("2026-07", "late")];

        expect(buildLedgerLine(context({ ledger }))).toBe(
            "September's eighteen hundred forty dollars is unpaid, and July and August both came in late.",
        );
    });

    it("says how far back an unpaid balance goes when more than one month is unpaid (carried over)", () => {
        const ledger = [month("2026-09", "unpaid", 920), month("2026-08", "unpaid", 920)];

        expect(buildLedgerLine(context({ ledger }))).toBe(
            "There's eighteen hundred forty dollars unpaid going back to August.",
        );
    });

    it("uses the plain line when only one prior month was late (first time)", () => {
        const ledger = [month("2026-09", "unpaid"), month("2026-08", "late"), month("2026-07", "on_time")];

        expect(buildLedgerLine(context({ ledger }))).toBe("September's eighteen hundred forty dollars is unpaid.");
    });

    it("uses the invoice due month when there is no ledger", () => {
        expect(buildLedgerLine(context({ ledger: undefined }))).toBe(
            "September's eighteen hundred forty dollars is unpaid.",
        );
    });
});

describe("buildRentOpening", () => {
    it("is repair update, pivot, ledger, ask, in that order, when a repair is booked", () => {
        const opening = buildRentOpening(context({
            ledger: [month("2026-09", "unpaid")],
            maintenanceRequests: [{
                description: "Kitchen tap repair",
                status: "scheduled",
                urgency: "routine",
                reportedAt: "2026-09-20T00:00:00.000Z",
                resolvedAt: null,
                appointmentLabel: "Thursday morning",
            }],
        }));

        expect(opening).toBe(
            "Quick update first: your kitchen tap repair is booked for Thursday morning. "
            + "The main reason I'm calling is your rent. "
            + "September's eighteen hundred forty dollars is unpaid. "
            + "Can you take care of it today?",
        );
    });

    it("skips the repair line when the open repair has no booked time", () => {
        const opening = buildRentOpening(context({
            ledger: [month("2026-09", "unpaid")],
            maintenanceRequests: [{
                description: "Kitchen tap dripping",
                status: "open",
                urgency: "routine",
                reportedAt: "2026-09-20T00:00:00.000Z",
                resolvedAt: null,
            }],
        }));

        expect(opening).toBe(
            "The main reason I'm calling is your rent. September's eighteen hundred forty dollars is unpaid. "
            + "Can you take care of it today?",
        );
    });

    it("never ties the repair to paying", () => {
        expect(buildRentOpening(getDemoCallContext())).not.toMatch(/once you pay|after you pay|if you pay/i);
    });
});

describe("voice call instructions", () => {
    const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };
    const TODAY_PLAN = { installments: [{ date: new Date().toISOString().slice(0, 10), amount: 1840 }] };

    it("has the agent say the rent opening word for word once the tenant confirms, with no check-in", () => {
        const ctx = getDemoCallContext();
        const prompt = buildNegotiationInstructions(ctx, true, "voice", { feedbackRecorded: false });

        expect(prompt).toContain(buildRentOpening(ctx));
        expect(prompt).not.toMatch(/CHECK-IN FIRST/);
    });

    it("covers the test lines: who is this, why are you calling, back to the repair, pay when fixed", () => {
        const prompt = buildNegotiationInstructions(getDemoCallContext(), true, "voice");

        expect(prompt).toContain("It's Mia from Maple Court Property Management. The main reason I'm calling is your rent.");
        expect(prompt).toContain("About your rent: eighteen hundred forty dollars is unpaid. Can you take care of it today?");
        expect(prompt).toContain("That's booked either way. Now, about the eighteen hundred forty dollars.");
        expect(prompt).toMatch(/pay once a repair is fixed[^\n]*urgent_repair/);
        expect(prompt).toMatch(/Never mention eviction, credit reporting, or legal action/);
    });

    it("keeps replies to a sentence or two under twenty words, with no filler", () => {
        const prompt = buildNegotiationInstructions(getDemoCallContext(), true, "voice");

        expect(prompt).toMatch(/under twenty words/);
        expect(prompt).toMatch(/No filler/);
    });

    it("never introduces itself as AI unprompted but never claims to be human", () => {
        const prompt = buildNegotiationInstructions(getDemoCallContext(), true, "voice");

        expect(prompt).not.toMatch(/introduced yourself as an AI assistant/);
        expect(prompt).toMatch(/never claim to be a person/i);
    });

    it("lets plan tools run on a call without a check-in", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(getDemoCallContext(), state, { channel: "voice" });

        const result = await tools.check_policy.execute?.(TODAY_PLAN, TOOL_OPTIONS);

        expect(result).toMatchObject({ status: "accepted" });
    });
});

describe("ledgerFromStripeInvoices", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

    it("labels months unpaid, late, or on time from due and paid dates, newest first", () => {
        const ledger = ledgerFromStripeInvoices([
            { status: "paid", amount_due: 184000, due_date: ts("2026-07-28T23:59:59Z"), created: ts("2026-07-01T00:00:00Z"), status_transitions: { paid_at: ts("2026-08-04T00:00:00Z") } },
            { status: "open", amount_due: 184000, due_date: ts("2026-09-28T23:59:59Z"), created: ts("2026-09-01T00:00:00Z"), status_transitions: { paid_at: null } },
            { status: "paid", amount_due: 184000, due_date: ts("2026-08-28T23:59:59Z"), created: ts("2026-08-01T00:00:00Z"), status_transitions: { paid_at: ts("2026-08-27T00:00:00Z") } },
            { status: "void", amount_due: 5000, due_date: ts("2026-09-10T23:59:59Z"), created: ts("2026-09-01T00:00:00Z"), status_transitions: { paid_at: null } },
        ], now);

        expect(ledger).toEqual([
            { month: "2026-09", amount: 1840, status: "unpaid" },
            { month: "2026-08", amount: 1840, status: "on_time" },
            { month: "2026-07", amount: 1840, status: "late" },
        ]);
    });
});

describe("paying in full", () => {
    const ctx = getDemoCallContext();
    const prompts = {
        negotiation: buildNegotiationInstructions(ctx, true, "voice"),
        hardship: buildPlaybookInstructions(ctx, true, "hardship", "voice"),
        dispute: buildPlaybookInstructions(ctx, true, "dispute", "voice"),
    };

    it.each(Object.entries(prompts))("%s: a yes, paying it all, or asking for the link goes straight to accept_plan", (_, prompt) => {
        expect(prompt).toMatch(/PAYING IN FULL/);
        expect(prompt).toMatch(/asks? for the payment link/);
        expect(prompt).toMatch(/call accept_plan right away with one payment of 1840 due today/);
        expect(prompt).toMatch(/Do not ask for an amount, offer a plan, or call check_policy first/);
    });
});
