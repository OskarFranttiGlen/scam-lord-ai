/**
 * @module agent-floor/agents
 * Floor agent shape. Rows come from calls (ADR 0001 / 03).
 * Depends on: none.
 * Used by: AgentFloor, row-to-agent, chat readAgents.
 */

export const AGENT_STEPS = [
    "invoice",
    "workflow_start",
    "disclosure",
    "jev",
    "policy",
    "plan",
    "payment_link",
    "paid",
    "handoff",
] as const;

export type TAgentStep = (typeof AGENT_STEPS)[number];

export type TAgentStatus = "in_progress" | "waiting_on_payment" | "waiting_on_person" | "paid";

export interface IAgentInvoice {
    amount: number;
    status: string;
    dueDate: string;
    hostedUrl: string;
}

export interface IAgentSchedule {
    installments: number;
    dates: string[];
    amounts: number[];
}

export interface IAgentOutcomes {
    callPlaced: boolean;
    planAccepted: boolean;
    paymentCleared: boolean;
}

export interface IAgentPolicy {
    maxInstallments: number;
    graceDays: number;
    feeWaiverCap: number;
}

export interface IAgentPerk {
    id: string;
    text: string;
    condition: string;
}

export interface IJevCheck {
    hardship: number;
    dispute: number;
    distressed: number;
    outcome: "continue" | "handoff";
}

export interface IAgentTrace {
    transcript: string[];
    perkId: string | null;
    plan: string;
    jev: IJevCheck[];
}

export interface IAgent {
    id: string;
    tenant: string;
    property: string;
    status: TAgentStatus;
    currentStep: TAgentStep;
    invoice: IAgentInvoice;
    schedule: IAgentSchedule;
    outcomes: IAgentOutcomes;
    policy: IAgentPolicy;
    perks: IAgentPerk[];
    trace: IAgentTrace;
}

/** Edges. `paid` and `handoff` are the two endings, not a sequence. */
export const AGENT_EDGES: ReadonlyArray<readonly [TAgentStep, TAgentStep]> = [
    ["invoice", "workflow_start"],
    ["workflow_start", "disclosure"],
    ["disclosure", "jev"],
    ["jev", "policy"],
    ["jev", "handoff"],
    ["policy", "plan"],
    ["plan", "payment_link"],
    ["payment_link", "paid"],
];
