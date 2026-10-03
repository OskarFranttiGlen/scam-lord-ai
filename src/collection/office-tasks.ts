/**
 * @module collection/office-tasks
 *
 * Office task types the agent can open on a call, and which of them pause collection on the
 * invoice. Due dates are set in code, never by the model.
 *
 * Depends on: none
 * Used by: @/voice/tools.ts, @/voice/persist-call.ts, @/text/conversation-store.ts
 */

export const OFFICE_TASK_TYPES = [
    "payment_match",
    "disputed_line",
    "assistance_paperwork",
    "tenant_portion",
    "move_out_deposit",
    "confirm_claim",
    "urgent_repair",
    "lease_change",
    "tenancy_at_risk",
    "missed_promises",
    "due_date_change",
] as const;

export type TOfficeTaskType = (typeof OFFICE_TASK_TYPES)[number];

/** No new collection call on the invoice until the due date while one of these is open. */
const PAUSING_TYPES = new Set<TOfficeTaskType>([
    "payment_match",
    "disputed_line",
    "assistance_paperwork",
    "tenant_portion",
    "confirm_claim",
    "urgent_repair",
]);

/**
 * True when an open task of this type pauses collection calls on its invoice.
 *
 * @param type - Office task type
 */
export function pausesCollection(type: TOfficeTaskType): boolean {
    return PAUSING_TYPES.has(type);
}

/**
 * True when an open task of this type means no plan or payment link on the invoice until the
 * office has checked it (the tenant may not owe it, or not all of it).
 *
 * @param type - Office task type
 */
export function blocksPayment(type: TOfficeTaskType): boolean {
    return type === "payment_match" || type === "disputed_line";
}

/**
 * Tomorrow's date in UTC, `YYYY-MM-DD`.
 *
 * @param now - Clock reading; defaults to the current time
 */
export function tomorrowIsoDate(now: Date = new Date()): string {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}
