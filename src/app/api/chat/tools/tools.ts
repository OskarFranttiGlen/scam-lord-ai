/**
 * @module chat/tools
 *
 * The Agent manager reads the floor JSON. It does not start or change an agent (ADR 0002 / 03).
 * Depends on: ai, zod, agent-floor/agents.
 * Used by: /api/chat/route.ts
 */

import { tool } from "ai";
import { z } from "zod";
import { DEFAULT_AGENTS } from "@/lib/agent-floor/agents";

/**
 * Tool registry for the Agent manager.
 * The chat route still passes the artifact document. This tool ignores it.
 *
 * @param _props - Ignored. Kept so `route.ts` can keep its current call.
 * @returns The readAgents tool.
 */
export function getTools(_props?: { artifactDocument?: TChatArtifactDocument }) {
    void _props;

    return {
        readAgents: tool({
            description: "Read the agents on the floor: status, current step, tenant, property, trace, invoice, schedule, outcomes, policy, and perks.",
            inputSchema: z.object({}),
            execute: async () => DEFAULT_AGENTS,
        }),
    };
}

/** Inferred from `getTools` so the chat route stays typed. */
export type TChatTools = ReturnType<typeof getTools>;
