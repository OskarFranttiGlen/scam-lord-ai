/**
 * Agent view fields (ADR 0002 / 02).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAgent } from "@/lib/agent-floor/agents";
import { AgentView } from "../AgentView";

vi.mock("@xyflow/react", () => ({
    ReactFlow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Background: () => null,
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

describe("AgentView", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders the handoff agent with no text field", () => {
        const agent = findAgent("agent-handoff");
        if (!agent) {
            throw new Error("handoff agent missing");
        }

        render(
            <AgentView agent={agent} onBack={() => undefined} />,
        );

        expect(screen.getByText("Casey Diaz")).toBeTruthy();
        expect(screen.getByText("Hardship")).toBeTruthy();
        expect(screen.getByText("0.82")).toBeTruthy();
        expect(screen.getAllByText("$960.00").length).toBeGreaterThan(0);
        expect(screen.getByText("Fee-waiver cap")).toBeTruthy();
        expect(screen.getByText("$0.00")).toBeTruthy();
        expect(screen.getByRole("button", { name: /back to floor/i })).toBeTruthy();
        expect(screen.queryByRole("textbox")).toBeNull();
    });
});
