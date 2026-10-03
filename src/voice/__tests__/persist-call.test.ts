import { describe, expect, it, vi } from "vitest";

import type { TablesInsert } from "@/hooks/supabase";
import { createInitialCallState, type CallState } from "@/voice/context";
import { getDemoCallContext } from "@/voice/demo-context";
import { persistCall } from "@/voice/persist-call";
import type { TVoiceSupabaseClient } from "@/voice/supabase-client";

const TENANCY_ID = "a4444444-4444-4444-8444-444444444401";

function asDb(mock: unknown): TVoiceSupabaseClient {
    return mock as TVoiceSupabaseClient;
}

/**
 * Supabase stand-in that records the `calls` upsert row and returns a fixed call id.
 */
function recordingDb() {
    const upserts: TablesInsert<"calls">[] = [];
    const maintenanceRows: TablesInsert<"maintenance_requests">[] = [];
    const officeTaskRows: TablesInsert<"office_tasks">[] = [];
    const db = {
        from: vi.fn((table: string) => ({
            upsert: (
                row: TablesInsert<"calls"> | TablesInsert<"maintenance_requests">[] | TablesInsert<"office_tasks">[],
            ) => {
                if (table === "maintenance_requests" && Array.isArray(row)) {
                    maintenanceRows.push(...(row as TablesInsert<"maintenance_requests">[]));
                    return Promise.resolve({ error: null });
                }
                if (table === "office_tasks" && Array.isArray(row)) {
                    officeTaskRows.push(...(row as TablesInsert<"office_tasks">[]));
                    return Promise.resolve({ error: null });
                }
                if (!Array.isArray(row) && "stripe_invoice_id" in row) {
                    upserts.push(row);
                }
                return { select: () => ({ single: () => Promise.resolve({ data: { id: "call-1" }, error: null }) }) };
            },
        })),
    };
    return { db: asDb(db), upserts, maintenanceRows, officeTaskRows };
}

const quietLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function persist(state: CallState, extra: Partial<Parameters<typeof persistCall>[0]> = {}) {
    const { db, upserts, maintenanceRows, officeTaskRows } = recordingDb();
    const result = persistCall({
        roomName: "callback-1",
        callContext: getDemoCallContext(),
        state,
        startedAt: new Date("2026-10-03T19:00:00Z"),
        endedAt: new Date("2026-10-03T19:02:00Z"),
        tenancyId: TENANCY_ID,
        client: db,
        log: quietLog,
        ...extra,
    });
    return { result, upserts, maintenanceRows, officeTaskRows };
}

describe("persistCall office tasks", () => {
    it("saves each office task opened on the call, linked to the call, tenancy, and invoice", async () => {
        const state: CallState = {
            ...createInitialCallState(),
            feedbackRecorded: true,
            officeTasks: [{
                id: "7b2e5c74-ac0a-4ea0-9c73-2d2a3e4f5061",
                type: "payment_match",
                details: "Says paid by Zelle on Oct 1",
                dueDate: "2026-10-04",
                collectionPausedUntil: "2026-10-04",
            }],
        };

        const { result, officeTaskRows } = persist(state);

        await result;
        expect(officeTaskRows).toEqual([{
            id: "7b2e5c74-ac0a-4ea0-9c73-2d2a3e4f5061",
            tenancy_id: TENANCY_ID,
            source_call_id: "call-1",
            stripe_invoice_id: getDemoCallContext().stripeInvoiceId,
            type: "payment_match",
            details: "Says paid by Zelle on Oct 1",
            due_date: "2026-10-04",
            collection_paused_until: "2026-10-04",
            status: "open",
        }]);
    });
});

describe("persistCall check-in", () => {
    it("stores the check-in feedback and an urgent-repair handoff reason", async () => {
        const state: CallState = {
            ...createInitialCallState(),
            handoffActive: true,
            urgentMaintenance: true,
            feedbackRecorded: true,
            tenantFeedback: "Ceiling is leaking",
        };

        const { result, upserts } = persist(state);

        await result;
        expect(upserts[0]).toMatchObject({
            tenant_feedback: "Ceiling is leaking",
            status: "waiting_on_person",
            handoff_reason: "urgent_maintenance",
        });
    });

    it("saves each repair raised on the call as a maintenance request linked to the call", async () => {
        const state: CallState = {
            ...createInitialCallState(),
            feedbackRecorded: true,
            maintenanceReports: [
                { id: "5f0c3a52-8a8e-4c8e-9a51-0b0f1c2d3e4f", description: "Bathroom fan noisy", urgent: false },
                { id: "6a1d4b63-9b9f-4d9f-8b62-1c1f2d3e4f50", description: "Ceiling leak", urgent: true },
            ],
        };

        const { result, maintenanceRows } = persist(state);

        await result;
        expect(maintenanceRows).toEqual([
            expect.objectContaining({
                id: "5f0c3a52-8a8e-4c8e-9a51-0b0f1c2d3e4f",
                tenancy_id: TENANCY_ID,
                description: "Bathroom fan noisy",
                urgency: "routine",
                status: "open",
                source_call_id: "call-1",
            }),
            expect.objectContaining({ description: "Ceiling leak", urgency: "urgent" }),
        ]);
    });
});

describe("persistCall channel", () => {
    it("stores outbound calls as outbound_call by default", async () => {
        const { result, upserts } = persist(createInitialCallState());

        await expect(result).resolves.toEqual({ callId: "call-1", planId: null });
        expect(upserts[0]).toMatchObject({ channel: "outbound_call", tenancy_id: TENANCY_ID });
    });

    it("stores inbound callbacks with channel callback", async () => {
        const { result, upserts } = persist(createInitialCallState(), { channel: "callback" });

        await result;
        expect(upserts[0]).toMatchObject({ channel: "callback", livekit_room_name: "callback-1", status: "in_progress" });
    });

    it("keeps a handoff carried in from an earlier conversation, with its reason", async () => {
        const state = { ...createInitialCallState(), handoffActive: true };

        const { result, upserts } = persist(state, { channel: "callback", carriedHandoffReason: "hardship" });

        await result;
        expect(upserts[0]).toMatchObject({ status: "waiting_on_person", handoff_reason: "hardship" });
    });
});
