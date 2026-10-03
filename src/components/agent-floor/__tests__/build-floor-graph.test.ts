/**
 * Floor graph layout (ADR 0002 / 02).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { AGENT_EDGES, AGENT_STEPS, DEFAULT_AGENTS } from "@/lib/agent-floor/agents";
import { buildFloorGraph } from "../build-floor-graph";

describe("buildFloorGraph", () => {
    const { nodes, edges } = buildFloorGraph(DEFAULT_AGENTS);

    it("builds one chain per agent", () => {
        const agentIds = new Set(nodes.map((node) => node.id.split(":")[0]));
        expect(agentIds.size).toBe(3);
        expect(nodes).toHaveLength(DEFAULT_AGENTS.length * AGENT_STEPS.length);
        expect(edges).toHaveLength(DEFAULT_AGENTS.length * AGENT_EDGES.length);
        expect(nodes.find((node) => node.id === "agent-waiting-payment:invoice")?.position.y).toBe(220);
    });

    it("marks only the current step on each chain", () => {
        expect(
            nodes.filter((node) => node.data.current).map((node) => node.id).sort(),
        ).toEqual([
            "agent-handoff:handoff",
            "agent-in-progress:jev",
            "agent-waiting-payment:payment_link",
        ]);
    });
});
