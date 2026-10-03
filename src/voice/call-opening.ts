/**
 * @module voice/call-opening
 *
 * The fixed call opening (docs/SPEC.md → Call opening): after the tenant confirms who they are,
 * one turn of repair update (only when booked), pivot, ledger line, and ask. Templated so every
 * renter with the same ledger hears the same words.
 *
 * Depends on: ./context, ./instructions
 * Used by: @/voice/instructions, @/voice/livekit-agent, @/payments/collection-context
 */

import type { CallContext, TLedgerMonth } from "./context";
import { spokenDollars } from "./instructions";

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/**
 * Month name for a YYYY-MM or YYYY-MM-DD string, e.g. "2026-09" → "September".
 *
 * @param isoMonth - Date string starting with YYYY-MM
 */
function monthName(isoMonth: string): string {
    return MONTHS[Number(isoMonth.slice(5, 7)) - 1] ?? isoMonth;
}

/** Who the call is for, as spoken. */
export function managerLabel(ctx: CallContext): string {
    return ctx.managerName?.trim() || ctx.propertyName;
}

/**
 * The one-sentence ledger line: carried over (two or more months unpaid), repeated late (the two
 * months before the unpaid one both came in late), or first time.
 *
 * @param ctx - Call context with the open balance and optional ledger
 */
export function buildLedgerLine(ctx: CallContext): string {
    const ledger = ctx.ledger ?? [];
    const unpaid = ledger.filter(row => row.status === "unpaid");
    const amount = spokenDollars(ctx.openBalance);
    if (unpaid.length >= 2) {
        return `There's ${amount} unpaid going back to ${monthName(unpaid[unpaid.length - 1].month)}.`;
    }
    const current = unpaid[0]?.month ?? ctx.invoiceDueDate;
    const prior = ledger.filter(row => row.month < current.slice(0, 7)).slice(0, 2);
    if (prior.length === 2 && prior.every(row => row.status === "late")) {
        return `${monthName(current)}'s ${amount} is unpaid, and ${monthName(prior[1].month)} and `
            + `${monthName(prior[0].month)} both came in late.`;
    }
    return `${monthName(current)}'s ${amount} is unpaid.`;
}

/**
 * The turn after the tenant confirms their identity: repair update (only a booked repair), the
 * pivot, the ledger line, and the ask.
 *
 * @param ctx - Call context
 */
export function buildRentOpening(ctx: CallContext): string {
    const booked = (ctx.maintenanceRequests ?? []).find(
        request => request.status !== "resolved" && request.appointmentLabel?.trim(),
    );
    const repair = booked
        ? `Quick update first: your ${booked.description.charAt(0).toLowerCase()}${booked.description.slice(1)} `
            + `is booked for ${booked.appointmentLabel?.trim()}. `
        : "";
    return `${repair}The main reason I'm calling is your rent. ${buildLedgerLine(ctx)} Can you take care of it today?`;
}

type TStripeLedgerInvoice = {
    status: string | null;
    amount_due: number;
    due_date: number | null;
    created: number;
    status_transitions?: { paid_at?: number | null } | null;
};

/**
 * Ledger rows from a customer's Stripe invoices: open past due → unpaid, paid after the due
 * date → late, otherwise on time. Draft, void, and uncollectible invoices are left out.
 *
 * @param invoices - The customer's recent invoices
 * @param now - Current time
 */
export function ledgerFromStripeInvoices(invoices: TStripeLedgerInvoice[], now: Date = new Date()): TLedgerMonth[] {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return invoices
        .filter(invoice => invoice.status === "open" || invoice.status === "paid")
        .map(invoice => {
            const due = invoice.due_date ?? invoice.created;
            const paidAt = invoice.status_transitions?.paid_at ?? null;
            const status: TLedgerMonth["status"] = invoice.status === "open"
                ? (due < nowSeconds ? "unpaid" : "on_time")
                : (paidAt !== null && paidAt > due ? "late" : "on_time");
            return {
                month: new Date(due * 1000).toISOString().slice(0, 7),
                amount: invoice.amount_due / 100,
                status,
            };
        })
        .sort((a, b) => b.month.localeCompare(a.month));
}
