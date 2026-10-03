/**
 * @module api/cron/follow-ups
 *
 * Vercel Cron endpoint for scheduled follow-up calls (docs/SPEC.md → Call, Follow-up calls).
 * Vercel calls it hourly with `Authorization: Bearer ${CRON_SECRET}`; the run dials tenancies
 * whose promised payment date passed unpaid, inside calling hours only.
 *
 * Depends on: next/server, @/payments/collection-context, @/payments/follow-ups,
 * @/payments/stripe, @/voice/outbound-call
 * Used by: Vercel Cron (vercel.json)
 */

import { NextResponse } from "next/server";

import { getCollectionDb } from "@/payments/collection-context";
import { runFollowUps } from "@/payments/follow-ups";
import { getStripeClient } from "@/payments/stripe";
import { startCollectionCall } from "@/voice/outbound-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs the follow-up pass.
 *
 * @param request - Cron request; must carry `Authorization: Bearer ${CRON_SECRET}`
 */
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error("[cron/follow-ups] CRON_SECRET is not set");
        return NextResponse.json({ error: "cron_not_configured" }, { status: 500 });
    }
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const stripe = getStripeClient();
    if (!stripe) {
        console.error("[cron/follow-ups] STRIPE_SECRET_KEY is not set");
        return NextResponse.json({ error: "stripe_not_configured" }, { status: 500 });
    }

    const summary = await runFollowUps({ stripe, db: getCollectionDb(), startCollectionCall });
    return NextResponse.json(summary);
}