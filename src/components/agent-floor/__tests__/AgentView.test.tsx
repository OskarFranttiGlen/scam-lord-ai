/**
 * Agent view fields (ADR 0002 / 02).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentView } from "../AgentView";
import type { IAgent } from "@/lib/agent-floor/agents";

vi.mock("@xyflow/react", () => ({
    ReactFlow: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Background: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    // FloorNav's viewport hooks (never invoked: useStore reports 0x0).
    useReactFlow: () => ({
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        setCenter: () => undefined,
        getZoom: () => 1,
        getNodes: () => [],
    }),
    useStore: () => 0,
    // StepNode's handles (never rendered: ReactFlow mock ignores nodeTypes).
    Handle: () => null,
    Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

describe("AgentView", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders the handoff agent with no text field", () => {
        const agent: IAgent = {
            id: "agent-handoff",
            tenant: "Casey Diaz",
            property: "9 Alder",
            status: "waiting_on_person",
            currentStep: "handoff",
            invoice: {
                amount: 960,
                status: "open",
                dueDate: "2026-08-28",
                hostedUrl: "https://pay.stripe.test/handoff",
            },
            schedule: { installments: 0, dates: [], amounts: [] },
            outcomes: { callPlaced: true, planAccepted: false, paymentCleared: false },
            policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 0 },
            perks: [],
            trace: {
                transcript: ["Casey: I lost my job. I can't pay this."],
                perkId: null,
                plan: "",
                jev: [{ hardship: 0.82, dispute: 0.1, distressed: 0.4, outcome: "handoff" }],
            },
        };

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
        expect(screen.getByText("Open balance")).toBeTruthy();
    });

    it("shows a payment-received success state", () => {
        const agent: IAgent = {
            id: "agent-paid",
            tenant: "Mina Cho",
            property: "4 Birch",
            status: "paid",
            currentStep: "paid",
            invoice: {
                amount: 0,
                status: "paid",
                dueDate: "2026-08-28",
                hostedUrl: "https://pay.stripe.test/paid",
            },
            schedule: { installments: 1, dates: ["2026-08-28"], amounts: [960] },
            outcomes: { callPlaced: true, planAccepted: true, paymentCleared: true },
            policy: { maxInstallments: 2, graceDays: 14, feeWaiverCap: 0 },
            perks: [],
            trace: { transcript: [], perkId: null, plan: "1 x 960", jev: [] },
        };

        render(<AgentView agent={agent} onBack={() => undefined} />);

        expect(screen.getByText("Payment received")).toBeTruthy();
        expect(screen.getByText("Paid")).toBeTruthy();
        expect(screen.queryByText("Open balance")).toBeNull();
    });
});
