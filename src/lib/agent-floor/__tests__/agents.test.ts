/**
 * Default agents for the floor (ADR 0002 / 01).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { AGENT_STEPS, DEFAULT_AGENTS, findAgent } from "@/lib/agent-floor/agents";

describe("default agents", () => {
    it("has three agents, one of each status", () => {
        expect(DEFAULT_AGENTS).toHaveLength(3);
        expect(DEFAULT_AGENTS.map((agent) => agent.status).sort()).toEqual(
            ["in_progress", "waiting_on_payment", "waiting_on_person"].sort(),
        );
    });

    it("keeps every current step in AGENT_STEPS", () => {
        for (const agent of DEFAULT_AGENTS) {
            expect(AGENT_STEPS).toContain(agent.currentStep);
        }
    });

    it("finds the handoff agent", () => {
        expect(findAgent("agent-handoff")).toMatchObject({
            id: "agent-handoff",
            currentStep: "handoff",
            status: "waiting_on_person",
        });
    });
});
