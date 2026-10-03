/**
 * Landlord call read (ADR 0001 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCalls } from "../load-calls";

function reader(
    data: unknown[] | null,
    error: { message: string } | null = null,
    invoices: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null },
): SupabaseClient {
    const mock: unknown = {
        from: () => ({
            select: () => ({
                order: async () => ({ data, error }),
            }),
        }),
        schema: () => ({
            from: () => ({
                select: () => ({
                    in: async () => invoices,
                }),
            }),
        }),
    };
    return mock as SupabaseClient;
}

describe("loadCalls", () => {
    it("returns no agents when the landlord has no calls", async () => {
        await expect(loadCalls(reader([]))).resolves.toEqual([]);
    });

    it("fills the open balance from the synced invoice", async () => {
        const agents = await loadCalls(reader(
            [{
                id: "call-1",
                stripe_invoice_id: "in_1",
                status: "in_progress",
                current_step: "disclosure",
                transcript: null,
                jev_checks: [],
                payment_link_sent: false,
                tenancies: null,
                plans: [],
            }],
            null,
            {
                data: [{
                    id: "in_1",
                    amount_remaining: "92000",
                    status: "open",
                    due_date: Date.UTC(2026, 9, 3) / 1000,
                    hosted_invoice_url: "https://pay.example/in_1",
                }],
                error: null,
            },
        ));
        expect(agents[0]?.invoice).toEqual({
            amount: 920,
            status: "open",
            dueDate: "2026-10-03",
            hostedUrl: "https://pay.example/in_1",
        });
    });

    it("throws when the read fails", async () => {
        await expect(loadCalls(reader(null, { message: "permission denied" }))).rejects.toThrow(
            "permission denied",
        );
    });
});
