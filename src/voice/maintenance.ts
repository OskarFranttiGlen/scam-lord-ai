/**
 * @module voice/maintenance
 *
 * Supabase side of the check-in (docs/SPEC.md): a tenancy's past maintenance requests for the
 * agent's context, whether the tenant already gave feedback recently, and saving the repairs
 * and office tasks raised in a conversation as `maintenance_requests` and `office_tasks` rows.
 *
 * Depends on: @/hooks/supabase, ./context, ./supabase-client
 * Used by: @/voice/persist-call.ts, @/voice/worker.ts, @/text/conversation-store.ts
 */

import type { TablesInsert } from "@/hooks/supabase";

import type { CallState, TMaintenanceReport, TMaintenanceRequest, TOfficeTask } from "./context";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "./supabase-client";

/** How recent earlier feedback must be for a callback or text thread to skip the check-in. */
export const RECENT_FEEDBACK_MS = 24 * 60 * 60 * 1000;

function asStatus(value: string): TMaintenanceRequest["status"] {
    return value === "scheduled" || value === "resolved" ? value : "open";
}

/**
 * Handoff reason for a finished conversation: an urgent repair wins over Jev's reason.
 *
 * @param state - Final agent state
 * @param jevReason - First reason of the latest Jev handoff, if any
 */
export function handoffReasonFor(state: CallState, jevReason: string | null): string | null {
    return state.urgentMaintenance ? "urgent_maintenance" : jevReason;
}

/**
 * The tenancy's maintenance requests, newest first (at most 10). Empty on any error.
 *
 * @param client - Service-role Supabase client
 * @param tenancyId - Tenancy row id
 */
export async function loadMaintenanceHistory(
    client: TVoiceSupabaseClient,
    tenancyId: string,
): Promise<TMaintenanceRequest[]> {
    const { data, error } = await client
        .from("maintenance_requests")
        .select("description, status, urgency, reported_at, resolved_at, appointment_label")
        .eq("tenancy_id", tenancyId)
        .order("reported_at", { ascending: false })
        .limit(10);
    if (error || !data) {
        return [];
    }
    return data.map(row => ({
        description: row.description,
        status: asStatus(row.status),
        urgency: row.urgency === "urgent" ? "urgent" : "routine",
        reportedAt: row.reported_at,
        resolvedAt: row.resolved_at,
        appointmentLabel: row.appointment_label,
    }));
}

/**
 * Whether any conversation for the tenancy recorded check-in feedback within the window.
 *
 * @param client - Service-role Supabase client
 * @param tenancyId - Tenancy row id
 * @param now - Current time
 */
export async function hasRecentFeedback(
    client: TVoiceSupabaseClient,
    tenancyId: string,
    now: Date = new Date(),
): Promise<boolean> {
    const { data, error } = await client
        .from("calls")
        .select("id")
        .eq("tenancy_id", tenancyId)
        .not("tenant_feedback", "is", null)
        .gte("updated_at", new Date(now.getTime() - RECENT_FEEDBACK_MS).toISOString())
        .limit(1);
    return !error && Boolean(data?.length);
}

/**
 * Check-in inputs for a voice call: the tenancy's maintenance history and whether feedback was
 * given in the last day. Finds the tenancy by phone when no id is known. `maintenanceRequests`
 * is undefined (keep the context's own) when Supabase or the tenancy is unavailable.
 *
 * @param input.tenancyId - Tenancy row id, when known
 * @param input.phone - Tenant phone from the call context
 * @param input.client - Supabase client; `undefined` uses the env service-role client
 */
export async function loadCheckInContext(input: {
    tenancyId: string | null;
    phone: string;
    client?: TVoiceSupabaseClient | null;
}): Promise<{ maintenanceRequests?: TMaintenanceRequest[]; recentFeedback: boolean }> {
    const client = input.client === undefined ? getVoiceSupabaseClient() : input.client;
    if (!client) {
        return { recentFeedback: false };
    }
    try {
        const tenancyId = input.tenancyId ?? (
            await client.from("tenancies").select("id").eq("phone", input.phone).limit(1).maybeSingle()
        ).data?.id;
        if (!tenancyId) {
            return { recentFeedback: false };
        }
        const [maintenanceRequests, recentFeedback] = await Promise.all([
            loadMaintenanceHistory(client, tenancyId),
            hasRecentFeedback(client, tenancyId),
        ]);
        return { maintenanceRequests, recentFeedback };
    } catch {
        return { recentFeedback: false };
    }
}

/**
 * Upserts the office tasks opened in a conversation (idempotent on the task id).
 *
 * @param client - Service-role Supabase client
 * @param input.tenancyId - Tenancy row id
 * @param input.callId - Conversation `calls.id` the tasks came from
 * @param input.stripeInvoiceId - Invoice a pausing task holds collection on
 * @param input.tasks - Tasks from agent state
 */
export async function saveOfficeTasks(
    client: TVoiceSupabaseClient,
    { tenancyId, callId, stripeInvoiceId, tasks }: {
        tenancyId: string;
        callId: string;
        stripeInvoiceId: string;
        tasks: TOfficeTask[];
    },
): Promise<void> {
    if (!tasks.length) {
        return;
    }
    const rows: TablesInsert<"office_tasks">[] = tasks.map(task => ({
        id: task.id,
        tenancy_id: tenancyId,
        source_call_id: callId,
        stripe_invoice_id: stripeInvoiceId,
        type: task.type,
        details: task.details,
        due_date: task.dueDate,
        collection_paused_until: task.collectionPausedUntil,
        status: "open",
    }));
    const { error } = await client.from("office_tasks").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
        throw new Error(`office_tasks write failed: ${error.message}`);
    }
}

/**
 * Upserts the repairs raised in a conversation (idempotent on the report id).
 *
 * @param client - Service-role Supabase client
 * @param input.tenancyId - Tenancy row id
 * @param input.callId - Conversation `calls.id` the repairs came from
 * @param input.reports - Reports from agent state
 */
export async function saveMaintenanceReports(
    client: TVoiceSupabaseClient,
    { tenancyId, callId, reports }: { tenancyId: string; callId: string; reports: TMaintenanceReport[] },
): Promise<void> {
    if (!reports.length) {
        return;
    }
    const rows: TablesInsert<"maintenance_requests">[] = reports.map(report => ({
        id: report.id,
        tenancy_id: tenancyId,
        description: report.description,
        urgency: report.urgent ? "urgent" : "routine",
        status: "open",
        source_call_id: callId,
    }));
    const { error } = await client.from("maintenance_requests").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
        throw new Error(`maintenance_requests write failed: ${error.message}`);
    }
}
