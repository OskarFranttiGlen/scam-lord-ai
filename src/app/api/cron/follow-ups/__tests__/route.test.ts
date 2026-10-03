/**
 * @vitest-environment node
 */
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCollectionDb } from "@/payments/collection-context";
import { runFollowUps, type TFollowUpRunSummary } from "@/payments/follow-ups";
import { getStripeClient } from "@/payments/stripe";
import { startCollectionCall } from "@/voice/outbound-call";
import { GET } from "../route";

vi.mock("@/payments/follow-ups", () => ({ runFollowUps: vi.fn() }));
vi.mock("@/payments/stripe", () => ({ getStripeClient: vi.fn() }));
vi.mock("@/payments/collection-context", () => ({ getCollectionDb: vi.fn() }));
vi.mock("@/voice/outbound-call", () => ({ startCollectionCall: vi.fn() }));

function asStripe(value: unknown): Stripe {
    return value as Stripe;
}

const SECRET = "cron-secret";

/**
 * A Vercel Cron request to the follow-ups endpoint.
 *
 * @param authorization - `Authorization` header value, if any
 */
function cronRequest(authorization?: string): Request {
    return new Request("http://localhost:3000/api/cron/follow-ups", {
        headers: authorization ? { authorization } : {},
    });
}

beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.mocked(getStripeClient).mockReturnValue(asStripe({ invoices: {} }));
    vi.mocked(getCollectionDb).mockReturnValue(null);
    vi.mocked(startCollectionCall).mockImplementation(async () => ({ roomName: "cron-room-1" }));
    vi.mocked(runFollowUps).mockResolvedValue({ due: 0, started: 0, outcomes: [] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe("GET /api/cron/follow-ups", () => {
    it("returns 500 when CRON_SECRET is not set", async () => {
        vi.stubEnv("CRON_SECRET", "");

        expect((await GET(cronRequest(`Bearer ${SECRET}`))).status).toBe(500);
        expect(runFollowUps).not.toHaveBeenCalled();
    });

    it("returns 401 without a bearer token", async () => {
        expect((await GET(cronRequest())).status).toBe(401);
        expect(runFollowUps).not.toHaveBeenCalled();
    });

    it("returns 401 for the wrong bearer token", async () => {
        expect((await GET(cronRequest("Bearer not-the-secret"))).status).toBe(401);
        expect(runFollowUps).not.toHaveBeenCalled();
    });

    it("returns 500 when Stripe is not configured", async () => {
        vi.mocked(getStripeClient).mockReturnValue(null);

        expect((await GET(cronRequest(`Bearer ${SECRET}`))).status).toBe(500);
        expect(runFollowUps).not.toHaveBeenCalled();
    });

    it("runs the follow-ups and returns the summary", async () => {
        const summary: TFollowUpRunSummary = {
            due: 2,
            started: 1,
            outcomes: [{ action: "call_started", invoiceId: "in_1", roomName: "r1", source: "demo_fallback" }],
        };
        vi.mocked(runFollowUps).mockResolvedValue(summary);
        const stripe = asStripe({ invoices: {} });
        vi.mocked(getStripeClient).mockReturnValue(stripe);

        const response = await GET(cronRequest(`Bearer ${SECRET}`));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(summary);
        expect(runFollowUps).toHaveBeenCalledWith({ stripe, db: null, startCollectionCall });
    });
});