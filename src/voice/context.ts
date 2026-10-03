/**
 * @module voice/context
 *
 * Call-scoped types for the collection voice **ToolLoopAgent** brain.
 *
 * Depends on: @/collection/types
 * Used by: @/voice/tools.ts, @/voice/agent.ts, @/voice/run-turn.ts, /api/voice/turn
 */

import type { TJevCheckRecord, TJevPlaybook } from "@/collection/types";
import { parseStopCase } from "@/collection/apply-signals";
import { OFFICE_TASK_TYPES, type TOfficeTaskType } from "@/collection/office-tasks";
import type { TStopCase } from "@/collection/stop-cases";

/** Landlord numeric limits (one row per landlord in Supabase). */
export type TCallPolicy = {
    maxInstallments: number;
    graceDays: number;
    feeWaiverCap: number;
};

/** Landlord-configured perk the agent may offer once conditions match. */
export type TCallPerk = {
    id: string;
    description: string;
    condition?: string;
};

/** A repair the tenant reported before this conversation (`maintenance_requests` row). */
export type TMaintenanceRequest = {
    description: string;
    status: "open" | "scheduled" | "resolved";
    urgency: "routine" | "urgent";
    reportedAt: string;
    resolvedAt: string | null;
    /** Spoken window when status is scheduled, e.g. "Thursday between 9 and 12". */
    appointmentLabel?: string | null;
};

/** A follow-up the agent opened for the office during this conversation (`office_tasks` row). */
export type TOfficeTask = {
    /** Row id, so re-saving the conversation does not duplicate the task. */
    id: string;
    type: TOfficeTaskType;
    details: string;
    dueDate: string;
    /** No new collection call on this invoice before this date; null when the task does not pause. */
    collectionPausedUntil: string | null;
};

/** A repair the tenant raised during this conversation; `id` is the row id it is saved under. */
export type TMaintenanceReport = {
    id: string;
    description: string;
    urgent: boolean;
};

/** One month of rent on the tenant's ledger. */
export type TLedgerMonth = {
    /** YYYY-MM of the rent due date. */
    month: string;
    amount: number;
    status: "unpaid" | "late" | "on_time";
};

/** What earlier conversations left behind, loaded from `calls.ai_notes`. */
export type TFollowUp = {
    /** "YYYY-MM-DD: summary" per earlier conversation, newest first. */
    notes: string[];
    /** Promised payment dates that passed while the balance was still owed, oldest first. */
    brokenPromises: Array<{ date: string; amount: number | null }>;
};

/** Tenancy + invoice snapshot loaded at call start. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- voice API contract name
export type CallContext = {
    tenantName: string;
    propertyName: string;
    unitLabel: string;
    phone: string;
    email: string;
    openBalance: number;
    invoiceDueDate: string;
    policy: TCallPolicy;
    perks: TCallPerk[];
    stripeInvoiceId: string;
    /** Past repairs for this tenancy, newest first. */
    maintenanceRequests?: TMaintenanceRequest[];
    /** Who the call is for (landlord or management company); falls back to the property name. */
    managerName?: string;
    /** Recent rent months, newest first. */
    ledger?: TLedgerMonth[];
    followUp?: TFollowUp;
};

/** Accepted plan persisted after policy approval and tenant acceptance. */
export type TAcceptedPlan = {
    installments: Array<{ date: string; amount: number }>;
    feeWaiver?: number;
    perkId?: string;
};

/** Mutable per-call state threaded through tools and the turn API. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- voice API contract name
export type CallState = {
    transcriptLines: string[];
    jevChecks: TJevCheckRecord[];
    handoffActive: boolean;
    acceptedPlan?: TAcceptedPlan;
    paymentLinkSent: boolean;
    /** Filled once the background Stripe + messaging step finishes. */
    paymentLinkUrl?: string;
    /** Stripe invoice the tenant pays first; confirm_payment checks it. */
    paymentInvoiceId?: string;
    /** The check-in happened (answered or declined); policy and payment tools stay locked until then. */
    feedbackRecorded: boolean;
    /** Check-in answer, or `declined`. */
    tenantFeedback?: string;
    maintenanceReports: TMaintenanceReport[];
    /** An urgent repair came up; the conversation is handed to a person. */
    urgentMaintenance: boolean;
    /** Active Jev playbook script (hardship, dispute, distressed) when playbook mode is on. */
    jevPlaybook?: TJevPlaybook;
    /** Times the tenant asked for a person on this call (handoff on the second). */
    personRequestCount: number;
    /** Stop-case playbook from the scenario doc, when the call must end with a person. */
    stopCase?: TStopCase;
    /** Closing satisfaction score 1–5, from record_closing_feedback. */
    satisfactionScore?: number;
    officeTasks: TOfficeTask[];
};

/**
 * Empty call state for a new conversation turn chain.
 */
export function createInitialCallState(): CallState {
    return {
        transcriptLines: [],
        jevChecks: [],
        handoffActive: false,
        paymentLinkSent: false,
        feedbackRecorded: false,
        maintenanceReports: [],
        urgentMaintenance: false,
        personRequestCount: 0,
        officeTasks: [],
    };
}

/**
 * Keeps well-formed maintenance reports from untrusted JSON.
 *
 * @param value - Raw `maintenanceReports` field
 */
function normalizeReports(value: unknown): TMaintenanceReport[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((item: unknown) => {
        if (item == null || typeof item !== "object") {
            return [];
        }
        const { id, description, urgent } = item as Partial<TMaintenanceReport>;
        return typeof id === "string" && typeof description === "string"
            ? [{ id, description, urgent: Boolean(urgent) }]
            : [];
    });
}

export { getDemoCallContext } from "./demo-context";

/**
 * Parses call state from API JSON, filling defaults for missing fields.
 *
 * @param value - Unknown JSON body fragment
 */
export function normalizeCallState(value: unknown): CallState {
    if (value == null || typeof value !== "object") {
        return createInitialCallState();
    }

    const raw = value as Partial<CallState>;
    return {
        transcriptLines: Array.isArray(raw.transcriptLines)
            ? raw.transcriptLines.filter((line): line is string => typeof line === "string")
            : [],
        jevChecks: Array.isArray(raw.jevChecks) ? raw.jevChecks : [],
        handoffActive: Boolean(raw.handoffActive),
        acceptedPlan: raw.acceptedPlan,
        paymentLinkSent: Boolean(raw.paymentLinkSent),
        paymentLinkUrl: typeof raw.paymentLinkUrl === "string" ? raw.paymentLinkUrl : undefined,
        paymentInvoiceId: typeof raw.paymentInvoiceId === "string" ? raw.paymentInvoiceId : undefined,
        feedbackRecorded: Boolean(raw.feedbackRecorded),
        tenantFeedback: typeof raw.tenantFeedback === "string" ? raw.tenantFeedback : undefined,
        maintenanceReports: normalizeReports(raw.maintenanceReports),
        urgentMaintenance: Boolean(raw.urgentMaintenance),
        jevPlaybook: raw.jevPlaybook === "hardship" || raw.jevPlaybook === "dispute" || raw.jevPlaybook === "distressed"
            ? raw.jevPlaybook
            : undefined,
        personRequestCount: typeof raw.personRequestCount === "number" ? raw.personRequestCount : 0,
        stopCase: parseStopCase(raw.stopCase),
        satisfactionScore: typeof raw.satisfactionScore === "number" ? raw.satisfactionScore : undefined,
        officeTasks: Array.isArray(raw.officeTasks)
            ? raw.officeTasks.filter((task): task is TOfficeTask => (
                task != null
                && typeof task === "object"
                && OFFICE_TASK_TYPES.includes((task as TOfficeTask).type)
                && typeof (task as TOfficeTask).id === "string"
                && typeof (task as TOfficeTask).details === "string"
                && typeof (task as TOfficeTask).dueDate === "string"
            ))
            : [],
    };
}
