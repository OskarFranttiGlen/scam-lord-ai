/**
 * Floor graph layout (ADR 0002 / 02).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { AGENT_EDGES, AGENT_STEPS, type IAgent, type TAgentStep } from "@/lib/agent-floor/agents";
import { buildFloorGraph } from "../build-floor-graph";
import { chainStartViewport } from "../StepNode";

function agent(id: string, currentStep: TAgentStep): IAgent {
    return {
        id,
        tenant: id,
        property: "",
        status: "in_progress",
        currentStep,
        invoice: { amount: 0, status: "", dueDate: "", hostedUrl: "" },
        schedule: { installments: 0, dates: [], amounts: [] },
        outcomes: { callPlaced: false, planAccepted: false, paymentCleared: false },
        policy: { maxInstallments: 0, graceDays: 0, feeWaiverCap: 0 },
        perks: [],
        trace: { transcript: [], perkId: null, plan: "", jev: [] },
    };
}

const agents = [
    agent("agent-in-progress", "jev"),
    agent("agent-waiting-payment", "payment_link"),
    agent("agent-handoff", "handoff"),
];

describe("buildFloorGraph", () => {
    const { nodes, edges } = buildFloorGraph(agents);

    it("builds one chain per agent", () => {
        const agentIds = new Set(nodes.map((node) => node.id.split(":")[0]));
        expect(agentIds.size).toBe(3);
        expect(nodes).toHaveLength(agents.length * AGENT_STEPS.length);
        expect(edges).toHaveLength(agents.length * AGENT_EDGES.length);
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

    it("uses step nodes and straight edges", () => {
        expect(nodes.every((node) => node.type === "step")).toBe(true);
        expect(edges.every((edge) => edge.type === "straight")).toBe(true);
    });

    it("marks a received payment as success on the paid step", () => {
        const paid = agent("agent-paid", "paid");
        paid.status = "paid";
        const graph = buildFloorGraph([paid]);
        expect(graph.nodes.find((node) => node.id === "agent-paid:paid")?.data.success).toBe(true);
        expect(graph.nodes.filter((node) => node.data.success)).toHaveLength(1);
    });

    it("places the chain head at x = 0", () => {
        expect(nodes[0]?.position.x).toBe(0);
        expect(nodes[0]?.id.endsWith(":invoice")).toBe(true);
    });

    it("pins the viewport to the chain head on the left", () => {
        expect(chainStartViewport({ position: { x: 0, y: 0 } })).toEqual({
            x: 48,
            y: 80,
            zoom: 1,
        });
    });
});
