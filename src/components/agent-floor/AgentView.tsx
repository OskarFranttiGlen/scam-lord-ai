"use client";

/**
 * @module AgentView
 * One agent's chain plus the trace, Stripe fields, and read-only policy (ADR 0002 / 02).
 * Depends on: build-floor-graph, @xyflow/react, status-badge, invoice-row, button.
 * Used by: AgentFloor.
 */

import type { ReactNode } from "react";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { IAgent, TAgentStatus, TAgentStep } from "@/lib/agent-floor/agents";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/components/ui/invoice-row";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, type TStatus } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { buildFloorGraph } from "./build-floor-graph";
import { FloorNav } from "./FloorNav";
import {
    FLOOR_MAX_ZOOM,
    FLOOR_MIN_ZOOM,
    FLOOR_NODE_TYPES,
    chainStartViewport,
} from "./StepNode";

const STATUS_TO_BADGE: Record<TAgentStatus, TStatus> = {
    in_progress: "in-progress",
    waiting_on_payment: "waiting-on-payment",
    waiting_on_person: "waiting-on-person",
};

const STEP_LABEL: Record<TAgentStep, string> = {
    invoice: "Invoice",
    workflow_start: "Workflow start",
    disclosure: "Disclosure",
    jev: "Jev check",
    policy: "Policy",
    plan: "Plan",
    payment_link: "Payment link",
    paid: "Paid",
    handoff: "Handoff",
};

interface IProps {
    agent: IAgent;
    onBack: () => void;
}

function Section({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                {title}
            </h3>
            {children}
        </section>
    );
}

function MetaRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium tabular-nums">{value}</span>
        </div>
    );
}

function OutcomeRow({ label, done }: { label: string; done: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span className={cn(done ? "text-foreground" : "text-muted-foreground")}>
                {label}
            </span>
            <span
                className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full",
                    done
                        ? "bg-status-paid text-status-paid-foreground"
                        : "bg-muted text-muted-foreground",
                )}
                aria-label={done ? `${label}: yes` : `${label}: no`}
            >
                {done ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            </span>
        </div>
    );
}

/**
 * @param props.agent - The agent opened from the floor.
 * @param props.onBack - Returns to the floor.
 */
export function AgentView({ agent, onBack }: IProps) {
    const { nodes, edges } = buildFloorGraph([agent]);
    const latestJev = agent.trace.jev[agent.trace.jev.length - 1];

    return (
        <div className="flex h-full min-h-0">
            <div className="h-full min-h-0 flex-1">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={FLOOR_NODE_TYPES}
                    defaultViewport={nodes[0] ? chainStartViewport(nodes[0]) : undefined}
                    minZoom={FLOOR_MIN_ZOOM}
                    maxZoom={FLOOR_MAX_ZOOM}
                >
                    <Background />
                    <FloorNav />
                </ReactFlow>
            </div>

            <aside
                className="flex w-[22rem] shrink-0 flex-col border-l bg-background animate-in slide-in-from-right-4 fade-in duration-200"
                aria-label={`${agent.tenant} agent details`}
            >
                <header className="shrink-0 space-y-3 border-b px-4 py-4">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        className="-ml-2 h-9 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to floor
                    </Button>

                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="truncate font-main text-xl leading-tight tracking-tight">
                                {agent.tenant}
                            </h2>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">
                                {agent.property}
                            </p>
                        </div>
                        <StatusBadge
                            status={STATUS_TO_BADGE[agent.status]}
                            className="shrink-0"
                        />
                    </div>

                    <div className="rounded-[1.25rem] bg-muted/60 px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                            Open balance
                        </p>
                        <p className="mt-1 font-main text-2xl tabular-nums tracking-tight">
                            {formatMoney(agent.invoice.amount)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Due {agent.invoice.dueDate}
                            {" · "}
                            {STEP_LABEL[agent.currentStep]}
                        </p>
                    </div>
                </header>

                <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-6 px-4 py-5">
                        <Section title="Trace">
                            <div className="space-y-2">
                                {agent.trace.transcript.map((line, index) => {
                                    const isAgent = line.startsWith("Agent:");
                                    const body = line.replace(/^(Agent|[^:]+):\s*/, "");
                                    const speaker = isAgent
                                        ? "Agent"
                                        : line.split(":")[0] ?? "Tenant";
                                    return (
                                        <div
                                            key={index}
                                            className={cn(
                                                "rounded-xl px-3 py-2 text-sm leading-relaxed",
                                                isAgent
                                                    ? "bg-muted text-foreground"
                                                    : "bg-brand-ink text-brand-mint dark:bg-brand-mint dark:text-brand-ink",
                                            )}
                                        >
                                            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                                                {speaker}
                                            </p>
                                            <p>{body}</p>
                                        </div>
                                    );
                                })}
                            </div>

                            {agent.trace.plan ? (
                                <p className="rounded-xl border px-3 py-2 text-sm">
                                    <span className="text-muted-foreground">Plan · </span>
                                    {agent.trace.plan}
                                </p>
                            ) : null}

                            {latestJev ? (
                                <div className="space-y-2 rounded-xl border px-3 py-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium">Jev</span>
                                        <span
                                            className={cn(
                                                "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                                                latestJev.outcome === "handoff"
                                                    ? "bg-status-overdue text-status-overdue-foreground"
                                                    : "bg-status-paid text-status-paid-foreground",
                                            )}
                                        >
                                            {latestJev.outcome}
                                        </span>
                                    </div>
                                    <MetaRow
                                        label="Hardship"
                                        value={String(latestJev.hardship)}
                                    />
                                    <MetaRow
                                        label="Dispute"
                                        value={String(latestJev.dispute)}
                                    />
                                    <MetaRow
                                        label="Distressed"
                                        value={String(latestJev.distressed)}
                                    />
                                </div>
                            ) : null}
                        </Section>

                        <Separator />

                        <Section title="Invoice">
                            <div className="space-y-2">
                                <MetaRow
                                    label="Amount"
                                    value={formatMoney(agent.invoice.amount)}
                                />
                                <MetaRow
                                    label="Status"
                                    value={agent.invoice.status}
                                />
                                <MetaRow
                                    label="Due"
                                    value={agent.invoice.dueDate}
                                />
                            </div>
                            <Button asChild variant="outline" size="sm" className="w-full">
                                <a
                                    href={agent.invoice.hostedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Open payment link
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            </Button>
                        </Section>

                        <Separator />

                        <Section title="Schedule">
                            {agent.schedule.dates.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No plan yet</p>
                            ) : (
                                <div className="space-y-2">
                                    {agent.schedule.dates.map((date, index) => (
                                        <MetaRow
                                            key={date}
                                            label={date}
                                            value={formatMoney(
                                                agent.schedule.amounts[index] ?? 0,
                                            )}
                                        />
                                    ))}
                                </div>
                            )}
                        </Section>

                        <Separator />

                        <Section title="Outcomes">
                            <div className="space-y-2.5">
                                <OutcomeRow
                                    label="Call placed"
                                    done={agent.outcomes.callPlaced}
                                />
                                <OutcomeRow
                                    label="Plan accepted"
                                    done={agent.outcomes.planAccepted}
                                />
                                <OutcomeRow
                                    label="Payment cleared"
                                    done={agent.outcomes.paymentCleared}
                                />
                            </div>
                        </Section>

                        <Separator />

                        <Section title="Policy">
                            <div className="space-y-2">
                                <MetaRow
                                    label="Max installments"
                                    value={String(agent.policy.maxInstallments)}
                                />
                                <MetaRow
                                    label="Grace window"
                                    value={`${agent.policy.graceDays} days`}
                                />
                                <MetaRow
                                    label="Fee-waiver cap"
                                    value={formatMoney(agent.policy.feeWaiverCap)}
                                />
                            </div>
                        </Section>

                        {agent.perks.length > 0 ? (
                            <>
                                <Separator />
                                <Section title="Perks">
                                    <ul className="space-y-2">
                                        {agent.perks.map((perk) => (
                                            <li
                                                key={perk.id}
                                                className="rounded-xl border px-3 py-2 text-sm leading-relaxed"
                                            >
                                                {perk.text}
                                            </li>
                                        ))}
                                    </ul>
                                </Section>
                            </>
                        ) : null}
                    </div>
                </ScrollArea>
            </aside>
        </div>
    );
}
