/**
 * @module payments/__tests__/supabase-mock
 *
 * Chainable Supabase mock for collection-table reads and writes: every filter returns the
 * builder, and awaiting it (or `maybeSingle`) resolves to the configured table result.
 *
 * Depends on: vitest, @supabase/supabase-js
 * Used by: payments tests
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";

export type TTableResult = { data: unknown; error: { message: string } | null };

/**
 * Builds a mock client whose `from(table)` resolves to `results[table]`.
 *
 * @param results - Result per table name; missing tables resolve to `{ data: null, error: null }`
 */
export function createSupabaseMock(results: Record<string, TTableResult>) {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const from = vi.fn((table: string) => {
        const result = results[table] ?? { data: null, error: null };
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "limit", "update"]) {
            builder[method] = (...args: unknown[]) => {
                calls.push({ table, method, args });
                return builder;
            };
        }
        builder.maybeSingle = async () => result;
        builder.then = (resolve: (value: TTableResult) => unknown) => Promise.resolve(result).then(resolve);
        return builder;
    });
    const db: unknown = { from };
    return { db: db as SupabaseClient, from, calls };
}
