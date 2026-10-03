/**
 * @module landlord-home/row-to-agent
 * Maps a stored call (and its tenancy, plan, policy, perks) onto the floor agent.
 * Depends on: agent-floor/agents.
 * Used by: load-calls.
 */

import {
    AGENT_STEPS,
    type IAgent,
    type IJevCheck,
    type TAgentStatus,
    type TAgentStep,
} from "@/lib/agent-floor/agents";

const STATUSES = new Set<TAgentStatus>(["in_progress", "waiting_on_payment", "waiting_on_person", "paid"]);
const STEPS = new Set<string>(AGENT_STEPS);

/** Stripe Sync invoice joined on `calls.stripe_invoice_id`. */
export interface ISyncedCallInvoice {
    amountRemainingCents: number;
    status: string | null;
    /** Unix seconds. */
    dueDateUnix: number | null;
    hostedUrl: string | null;
}

export interface ICallNest {
    id: string;
    stripe_invoice_id: string | null;
    status: string;
    current_step: string | null;
    transcript: string | null;
    jev_checks: unknown;
    payment_link_sent: boolean;
    tenancies: {
        name: string;
        units: {
            label: string;
            properties: {
                name: string;
                landlords: {
                    policies: {
                        max_installments: number;
                        grace_days: number;
                        fee_waiver_cap: number;
                    } | null;
                    perks: { id: string; body: string; condition_text: string }[];
                } | null;
            } | null;
        } | null;
    } | null;
    plans: {
        installment_count: number;
        installment_dates: string[];
        installment_amounts: number[];
        perk_id: string | null;
    }[] | null;
}

function statusOf(value: string): TAgentStatus {
    return STATUSES.has(value as TAgentStatus) ? value as TAgentStatus : "in_progress";
}

function stepOf(value: string | null): TAgentStep {
    return value && STEPS.has(value) ? value as TAgentStep : "invoice";
}

function jevOf(value: unknown): IJevCheck[] {
    if (!Array.isArray(value)) return [];
    const checks: IJevCheck[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const record = item as {
            probabilities?: { hardship?: unknown; dispute?: unknown; distressed?: unknown };
            outcome?: { decision?: unknown };
        };
        const outcome = record.outcome?.decision;
        if (outcome !== "continue" && outcome !== "handoff") continue;
        const probabilities = record.probabilities;
        if (!probabilities) continue;
        checks.push({
            hardship: Number(probabilities.hardship) || 0,
            dispute: Number(probabilities.dispute) || 0,
            distressed: Number(probabilities.distressed) || 0,
            outcome,
        });
    }
    return checks;
}

/** Open balance is this invoice's amount remaining. */
function invoiceOf(synced: ISyncedCallInvoice | undefined) {
    if (!synced) {
        return { amount: 0, status: "", dueDate: "", hostedUrl: "" };
    }
    const due = synced.dueDateUnix;
    return {
        amount: synced.amountRemainingCents / 100,
        status: synced.status ?? "",
        dueDate: due == null ? "" : new Date(due * 1000).toISOString().slice(0, 10),
        hostedUrl: synced.hostedUrl ?? "",
    };
}

function planLabel(count: number, amounts: number[]): string {
    const first = amounts[0] ?? 0;
    if (amounts.length > 0 && amounts.every((amount) => amount === first)) {
        return `${count} x ${first}`;
    }
    return count > 0 ? `${count} installments` : "";
}

/**
 * @param rows - Nested `calls` select. Missing joins become empty agent fields.
 * @param invoices - Stripe Sync rows keyed by invoice id. Missing sync stays at $0.
 */
export function rowsToAgents(
    rows: readonly ICallNest[],
    invoices: ReadonlyMap<string, ISyncedCallInvoice> = new Map(),
): IAgent[] {
    return rows.map((row) => {
        const plan = row.plans?.[0] ?? null;
        const amounts = (plan?.installment_amounts ?? []).map(Number);
        const landlord = row.tenancies?.units?.properties?.landlords ?? null;
        const policy = landlord?.policies;
        const name = row.tenancies?.units?.properties?.name ?? "";
        const label = row.tenancies?.units?.label ?? "";
        const property = name && label ? `${name}, ${label}` : name || label;

        return {
            id: row.id,
            tenant: row.tenancies?.name ?? "",
            property,
            status: statusOf(row.status),
            currentStep: stepOf(row.current_step),
            invoice: invoiceOf(
                row.stripe_invoice_id ? invoices.get(row.stripe_invoice_id) : undefined,
            ),
            schedule: {
                installments: plan?.installment_count ?? 0,
                dates: plan?.installment_dates ?? [],
                amounts,
            },
            outcomes: {
                callPlaced: Boolean(row.transcript?.trim()) || row.payment_link_sent,
                planAccepted: plan !== null,
                paymentCleared: row.status === "paid",
            },
            policy: {
                maxInstallments: policy?.max_installments ?? 0,
                graceDays: policy?.grace_days ?? 0,
                feeWaiverCap: Number(policy?.fee_waiver_cap) || 0,
            },
            perks: (landlord?.perks ?? []).map((perk) => ({
                id: perk.id,
                text: perk.body,
                condition: perk.condition_text,
            })),
            trace: {
                transcript: row.transcript?.split("\n").filter((line) => line.trim()) ?? [],
                perkId: plan?.perk_id ?? null,
                plan: plan ? planLabel(plan.installment_count, amounts) : "",
                jev: jevOf(row.jev_checks),
            },
        };
    });
}
