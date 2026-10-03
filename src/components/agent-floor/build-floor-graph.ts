/**
 * @module agent-floor/build-floor-graph
 * One React Flow chain per agent (ADR 0002 / 02).
 * Depends on: agent-floor/agents.
 * Used by: AgentFloor, AgentView.
 */

import type { Edge, Node } from "@xyflow/react";
import {
    AGENT_EDGES,
    AGENT_STEPS,
    type IAgent,
    type TAgentStep,
} from "@/lib/agent-floor/agents";

const STEP_LABEL: Record<TAgentStep, string> = {
    invoice: "Stripe invoice",
    workflow_start: "Workflow start",
    disclosure: "Disclosure",
    jev: "Jev check",
    policy: "Policy",
    plan: "Stripe plan",
    payment_link: "Payment link",
    paid: "Paid",
    handoff: "Handoff",
};

export interface IFloorNodeData extends Record<string, unknown> {
    label: string;
    tenant: string;
    current: boolean;
    /** Payment landed on this step. */
    success: boolean;
}

/**
 * @param agents - Agents to lay out. Each chain sits on `y = index * 220`.
 * @returns Nodes and edges. The current step has `data.current`.
 */
export function buildFloorGraph(agents: readonly IAgent[]): {
    nodes: Node<IFloorNodeData>[];
    edges: Edge[];
} {
    const nodes: Node<IFloorNodeData>[] = [];
    const edges: Edge[] = [];

    agents.forEach((agent, agentIndex) => {
        AGENT_STEPS.forEach((step, stepIndex) => {
            const current = agent.currentStep === step;
            nodes.push({
                id: `${agent.id}:${step}`,
                type: "step",
                position: { x: stepIndex * 200, y: agentIndex * 220 },
                data: {
                    label: STEP_LABEL[step],
                    tenant: agent.tenant,
                    current,
                    success: step === "paid" && (agent.status === "paid" || agent.currentStep === "paid"),
                },
            });
        });

        for (const [source, target] of AGENT_EDGES) {
            edges.push({
                id: `${agent.id}:${source}:${target}`,
                source: `${agent.id}:${source}`,
                target: `${agent.id}:${target}`,
                type: "straight",
                markerEnd: {
                    type: "arrowclosed",
                    width: 16,
                    height: 16,
                },
            });
        }
    });

    return { nodes, edges };
}
