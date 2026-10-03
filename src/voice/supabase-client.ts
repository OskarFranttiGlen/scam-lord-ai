/**
 * @module voice/supabase-client
 *
 * Service-role Supabase client for the LiveKit voice worker (plain Node, outside Next).
 * `@/api/supabase-admin` reads `SUPABASE_SECRET_KEY`, which the worker's `.env` does not
 * set, so this reads `SUPABASE_SERVICE_ROLE_KEY` first. Bypasses RLS: server-only.
 *
 * Depends on: @supabase/supabase-js, @/hooks/supabase (generated types)
 * Used by: @/voice/load-call-context.ts, @/voice/persist-call.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/hooks/supabase";

export type TVoiceSupabaseClient = SupabaseClient<Database>;

let cachedClient: TVoiceSupabaseClient | null = null;

/**
 * Returns the cached service-role client, or `null` when URL or key env vars are missing.
 */
export function getVoiceSupabaseClient(): TVoiceSupabaseClient | null {
    if (cachedClient) {
        return cachedClient;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
        || process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
        || process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !key) {
        return null;
    }

    cachedClient = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return cachedClient;
}
