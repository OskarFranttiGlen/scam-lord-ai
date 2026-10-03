/**
 * Landlord call read (ADR 0001 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCalls } from "../load-calls";

function reader(data: unknown[] | null, error: { message: string } | null = null): SupabaseClient {
    const mock: unknown = {
        from: () => ({
            select: () => ({
                order: async () => ({ data, error }),
            }),
        }),
    };
    return mock as SupabaseClient;
}

describe("loadCalls", () => {
    it("returns no agents when the landlord has no calls", async () => {
        await expect(loadCalls(reader([]))).resolves.toEqual([]);
    });

    it("throws when the read fails", async () => {
        await expect(loadCalls(reader(null, { message: "permission denied" }))).rejects.toThrow(
            "permission denied",
        );
    });
});
