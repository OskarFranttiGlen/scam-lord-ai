/**
 * @module voice/demo-context
 *
 * Demo tenancy snapshot for local LiveKit worker runs and hackathon staging.
 *
 * Depends on: ./context
 * Used by: @/voice/worker.ts, @/voice/context.ts
 */

import type { CallContext } from "./context";

/**
 * ISO timestamp `days` before now, so the demo history stays recent.
 *
 * @param days - Whole days back
 */
function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Returns call context from `DEMO_CALL_CONTEXT` JSON or the built-in overdue-rent demo.
 */
export function getDemoCallContext(): CallContext {
    const fromEnv = process.env.DEMO_CALL_CONTEXT;
    if (fromEnv) {
        try {
            return JSON.parse(fromEnv) as CallContext;
        } catch {
            console.warn("[voice] DEMO_CALL_CONTEXT is not valid JSON; using built-in demo.");
        }
    }

    return {
        tenantName: "Jordan Lee",
        propertyName: "Maple Court",
        unitLabel: "Unit 2B",
        phone: "+15555550102",
        email: "jordan.lee@example.com",
        openBalance: 1840,
        invoiceDueDate: "2026-09-28",
        policy: {
            maxInstallments: 2,
            graceDays: 14,
            feeWaiverCap: 75,
        },
        perks: [
            {
                id: "perk_mow",
                description: "we will mow the lawn this weekend",
                condition: "pay_open_balance_today",
            },
        ],
        stripeInvoiceId: "in_demo_maple_2b_sep",
        maintenanceRequests: [
            {
                description: "Kitchen tap dripping",
                status: "open",
                urgency: "routine",
                reportedAt: daysAgoIso(12),
                resolvedAt: null,
            },
            {
                description: "Smoke alarm battery chirping",
                status: "resolved",
                urgency: "routine",
                reportedAt: daysAgoIso(35),
                resolvedAt: daysAgoIso(33),
            },
        ],
    };
}
