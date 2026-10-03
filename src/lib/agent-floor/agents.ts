/**
 * @module agent-floor/agents
 * JSON default the floor and the Agent manager read (ADR 0002 / 01).
 * Depends on: none.
 * Used by: AgentFloor, chat readAgents.
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

export type TAgentStatus = "in_progress" | "waiting_on_payment" | "waiting_on_person";

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

const sharedPolicy: IAgentPolicy = {
    maxInstallments: 2,
    graceDays: 14,
    feeWaiverCap: 0,
};

const sharedPerks: IAgentPerk[] = [
    {
        id: "mow",
        text: "We'll mow the lawn this weekend if you pay the open balance today.",
        condition: "pay the open balance today",
    },
];

export const DEFAULT_AGENTS: IAgent[] = [
    {
        id: "agent-in-progress",
        tenant: "Avery Cole",
        property: "14 Birch",
        status: "in_progress",
        currentStep: "jev",
        invoice: {
            amount: 1800,
            status: "open",
            dueDate: "2026-09-01",
            hostedUrl: "https://pay.stripe.test/in-progress",
        },
        schedule: { installments: 0, dates: [], amounts: [] },
        outcomes: { callPlaced: true, planAccepted: false, paymentCleared: false },
        policy: sharedPolicy,
        perks: sharedPerks,
        trace: {
            transcript: [
                "Agent: I'm an AI assistant for 14 Birch. The open balance is $1,800.",
                "Avery: Can I split it into four?",
            ],
            perkId: null,
            plan: "",
            jev: [{ hardship: 0.1, dispute: 0.05, distressed: 0.08, outcome: "continue" }],
        },
    },
    {
        id: "agent-waiting-payment",
        tenant: "Blake Nguyen",
        property: "2 Cedar",
        status: "waiting_on_payment",
        currentStep: "payment_link",
        invoice: {
            amount: 2400,
            status: "open",
            dueDate: "2026-09-03",
            hostedUrl: "https://pay.stripe.test/waiting",
        },
        schedule: {
            installments: 2,
            dates: ["2026-10-03", "2026-10-17"],
            amounts: [1200, 1200],
        },
        outcomes: { callPlaced: true, planAccepted: true, paymentCleared: false },
        policy: sharedPolicy,
        perks: sharedPerks,
        trace: {
            transcript: [
                "Agent: Two payments of $1,200, and we'll mow the lawn this weekend.",
                "Blake: Send the link.",
            ],
            perkId: "mow",
            plan: "2 x $1,200",
            jev: [{ hardship: 0.12, dispute: 0.04, distressed: 0.06, outcome: "continue" }],
        },
    },
    {
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
        policy: sharedPolicy,
        perks: sharedPerks,
        trace: {
            transcript: ["Casey: I lost my job. I can't pay this."],
            perkId: null,
            plan: "",
            jev: [{ hardship: 0.82, dispute: 0.1, distressed: 0.4, outcome: "handoff" }],
        },
    },
];

/**
 * @param id - Agent id from a floor node.
 * @returns The default agent, or undefined when the id is unknown.
 */
export function findAgent(id: string): IAgent | undefined {
    return DEFAULT_AGENTS.find((agent) => agent.id === id);
}
