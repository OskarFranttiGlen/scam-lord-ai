/**
 * @module landlord-home/load-calls
 * Landlord-scoped call read. RLS filters tenancy → property → landlord.
 * Depends on: row-to-agent.
 * Used by: use-calls, chat readAgents.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IAgent } from "@/lib/agent-floor/agents";
import { rowsToAgents, type ICallNest } from "./row-to-agent";

const CALLS_SELECT = `
    id, status, current_step, transcript, jev_checks, payment_link_sent,
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

/** @param supabase - Browser or server client. The signed-in landlord's RLS applies. */
export async function loadCalls(supabase: SupabaseClient): Promise<IAgent[]> {
    const { data, error } = await supabase
        .from("calls")
        .select(CALLS_SELECT)
        .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rowsToAgents((data ?? []) as ICallNest[]);
}
