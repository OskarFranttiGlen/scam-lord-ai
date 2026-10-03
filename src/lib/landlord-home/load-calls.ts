/**
 * @module landlord-home/load-calls
 * Landlord-scoped call read. RLS filters tenancy → property → landlord.
 * Depends on: row-to-agent.
 * Used by: use-calls, chat readAgents.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IAgent } from "@/lib/agent-floor/agents";
import { rowsToAgents, type ICallNest, type ISyncedCallInvoice } from "./row-to-agent";

const CALLS_SELECT = `
    id, stripe_invoice_id, status, current_step, transcript, jev_checks, payment_link_sent,
    tenancies (
        name,
        units (
            label,
            properties (
                name,
                landlords (
                    policies (max_installments, grace_days, fee_waiver_cap),
                    perks (id, body, condition_text)
                )
            )
        )
    ),
    plans (installment_count, installment_dates, installment_amounts, perk_id)
`;

interface IStripeInvoiceRow {
    id: string;
    amount_remaining: number | string | null;
    status: string | null;
    due_date: number | string | null;
    hosted_invoice_url: string | null;
}

function cents(value: number | string | null | undefined): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
}

/** Missing sync tables stay blank so the floor still renders. */
async function loadInvoices(
    supabase: SupabaseClient,
    ids: string[],
): Promise<Map<string, ISyncedCallInvoice>> {
    const map = new Map<string, ISyncedCallInvoice>();
    if (ids.length === 0) return map;
    const { data, error } = await supabase
        .schema("stripe")
        .from("invoices")
        .select("id, amount_remaining, status, due_date, hosted_invoice_url")
        .in("id", ids);
    if (error || !data) return map;
    for (const row of data as IStripeInvoiceRow[]) {
        const due = row.due_date == null ? null : Number(row.due_date);
        map.set(row.id, {
            amountRemainingCents: cents(row.amount_remaining),
            status: row.status,
            dueDateUnix: due != null && Number.isFinite(due) ? due : null,
            hostedUrl: row.hosted_invoice_url,
        });
    }
    return map;
}

/** @param supabase - Browser or server client. The signed-in landlord's RLS applies. */
export async function loadCalls(supabase: SupabaseClient): Promise<IAgent[]> {
    const { data, error } = await supabase
        .from("calls")
        .select(CALLS_SELECT)
        .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ICallNest[];
    const ids = [...new Set(rows.map((row) => row.stripe_invoice_id).filter((id): id is string => Boolean(id)))];
    return rowsToAgents(rows, await loadInvoices(supabase, ids));
}
