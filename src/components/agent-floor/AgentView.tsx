"use client";

/**
 * @module AgentView
 * One agent's chain plus the trace, Stripe fields, and read-only policy (ADR 0002 / 02).
 * Depends on: build-floor-graph, @xyflow/react.
 * Used by: AgentFloor.
 */

import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { IAgent, TAgentStatus } from "@/lib/agent-floor/agents";
import { buildFloorGraph } from "./build-floor-graph";

const STATUS_LABEL: Record<TAgentStatus, string> = {
    in_progress: "in progress",
    waiting_on_payment: "waiting on payment",
    waiting_on_person: "waiting on a person",
};

interface IProps {
    agent: IAgent;
    onBack: () => void;
}

/**
 * @param props.agent - The agent opened from the floor.
 * @param props.onBack - Returns to the floor.
 */
export function AgentView({ agent, onBack }: IProps) {
    const { nodes, edges } = buildFloorGraph([agent]);

    return (
        <div className="flex h-full min-h-0">
            <div className="h-full min-h-0 flex-1">
                <ReactFlow nodes={ nodes } edges={ edges } fitView>
                    <Background />
                </ReactFlow>
            </div>
            <aside className="w-80 overflow-auto border-l p-4 text-sm">
                <button type="button" onClick={ onBack }>
                    Back
                </button>
                <h2 className="mt-3 text-lg font-semibold">{ agent.tenant }</h2>
                <p>{ agent.property }</p>
                <p>{ STATUS_LABEL[agent.status] }</p>

                <h3 className="mt-4 font-semibold">Trace</h3>
                { agent.trace.transcript.map((line, index) => (
                    <p key={ index }>{ line }</p>
                )) }
                <p>{ agent.trace.plan }</p>
                { agent.trace.jev.map((check, index) => (
                    <p key={ index }>
                        hardship { check.hardship }
                    </p>
                )) }

                <h3 className="mt-4 font-semibold">Invoice</h3>
                <p>{ `$${agent.invoice.amount}` }</p>
                <p>{ agent.invoice.status }</p>
                <p>{ agent.invoice.dueDate }</p>
                <a href={ agent.invoice.hostedUrl }>{ agent.invoice.hostedUrl }</a>

                <h3 className="mt-4 font-semibold">Schedule</h3>
                { agent.schedule.dates.map((date, index) => (
                    <p key={ date }>
                        { date }
                        { " " }
                        { `$${agent.schedule.amounts[index] ?? ""}` }
                    </p>
                )) }

                <h3 className="mt-4 font-semibold">Outcomes</h3>
                <p>
                    call placed
                    { " " }
                    { agent.outcomes.callPlaced ? "yes" : "no" }
                </p>
                <p>
                    plan accepted
                    { " " }
                    { agent.outcomes.planAccepted ? "yes" : "no" }
                </p>
                <p>
                    payment cleared
                    { " " }
                    { agent.outcomes.paymentCleared ? "yes" : "no" }
                </p>

                <h3 className="mt-4 font-semibold">Policy</h3>
                <p>
                    maximum installments
                    { " " }
                    { agent.policy.maxInstallments }
                </p>
                <p>
                    grace window
                    { " " }
                    { agent.policy.graceDays }
                </p>
                <p>
                    fee-waiver cap
                    { " " }
                    { agent.policy.feeWaiverCap }
                </p>

                <h3 className="mt-4 font-semibold">Perks</h3>
                { agent.perks.map((perk) => (
                    <p key={ perk.id }>{ perk.text }</p>
                )) }
            </aside>
        </div>
    );
}
