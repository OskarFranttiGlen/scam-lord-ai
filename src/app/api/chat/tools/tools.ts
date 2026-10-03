/**
 * @module chat/tools
 *
 * The Agent manager reads stored calls. It does not start or change an agent.
 * Depends on: ai, zod, load-calls.
 * Used by: /api/chat/route.ts
 */

import { tool } from "ai";
import { z } from "zod";
import { loadCalls } from "@/lib/landlord-home/load-calls";
import type { SupabaseClient } from "@supabase/supabase-js";

export function getTools(supabase: SupabaseClient) {
    return {
        readAgents: tool({
            description: "Read the agents on the floor: status, current step, tenant, property, trace, invoice, schedule, outcomes, policy, and perks. Empty when this landlord has no calls.",
            inputSchema: z.object({}),
            execute: async () => loadCalls(supabase),
        }),
    };
}

export type TChatTools = ReturnType<typeof getTools>;
