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
 * ISO timestamp at UTC midnight `days` before today, so the demo history stays recent and is
 * identical across calls on the same day.
 *
 * @param days - Whole days back
 */
function daysAgoIso(days: number): string {
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    return new Date(midnight.getTime() - days * 86_400_000).toISOString();
}

/**
 * Returns call context from `DEMO_CALL_CONTEXT` JSON or the built-in overdue-rent demo.
 * `DEMO_STRIPE_INVOICE_ID` (from `scripts/seed-stripe-demo.ts`) points the built-in demo at a
 * real Stripe test invoice so accepted plans become installment invoices.
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
        tenantName: "John Reyes",
        propertyName: "Sunset Apartments",
        unitLabel: "Unit 4",
        phone: "+15555550102",
        email: "john.reyes@example.com",
        openBalance: 2400,
        invoiceDueDate: "2026-10-01",
        policy: {
            maxInstallments: 2,
            graceDays: 15,
            feeWaiverCap: 75,
        },
        perks: [
            {
                id: "perk_mow",
                description: "we will mow the lawn this weekend",
                condition: "pay_open_balance_today",
            },
        ],
        stripeInvoiceId: process.env.DEMO_STRIPE_INVOICE_ID?.trim() || "in_demo_sunset_4_oct",
        managerName: "Sunset Properties",
        ledger: [
            { month: "2026-10", amount: 2400, status: "unpaid" },
            { month: "2026-09", amount: 2400, status: "late" },
            { month: "2026-08", amount: 2400, status: "late" },
            { month: "2026-07", amount: 2400, status: "on_time" },
        ],
        maintenanceRequests: [
            {
                description: "Tap repair",
                status: "scheduled",
                urgency: "routine",
                reportedAt: daysAgoIso(12),
                resolvedAt: null,
                appointmentLabel: "Thursday",
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
