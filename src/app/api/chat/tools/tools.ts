/**
 * @module chat/tools
 *
 * The Agent manager reads the floor JSON. It does not start or change an agent.
 * Depends on: ai, zod, agent-floor/agents.
 * Used by: /api/chat/route.ts
 */

import { tool } from "ai";
import { z } from "zod";
import { DEFAULT_AGENTS } from "@/lib/agent-floor/agents";

export function getTools() {
    return {
        readAgents: tool({
            description: "Read the agents on the floor: status, current step, tenant, property, trace, invoice, schedule, outcomes, policy, and perks.",
            inputSchema: z.object({}),
            execute: async () => DEFAULT_AGENTS,
        }),
    };
}

export type TChatTools = ReturnType<typeof getTools>;
