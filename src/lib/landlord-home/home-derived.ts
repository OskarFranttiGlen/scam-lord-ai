/**
 * @module landlord-home/home-derived
 * Needs you, funnel, and activity from floor agents. No Stripe.
 * Depends on: agent-floor/agents.
 * Used by: LandlordHome.
 */

import type { IAgent, TAgentStep } from "@/lib/agent-floor/agents";

export interface INeedsYouItem {
    id: string;
    tenant: string;
    property: string;
    badge: "waiting" | "handoff";
}

/** Agents a person must take: waiting on a person, or sitting on the handoff step. */
export function needsYou(agents: readonly IAgent[]): INeedsYouItem[] {
    const items: INeedsYouItem[] = [];
    for (const agent of agents) {
        const handoff = agent.currentStep === "handoff";
        if (!handoff && agent.status !== "waiting_on_person") continue;
        items.push({
            id: agent.id,
            tenant: agent.tenant,
            property: agent.property,
            badge: handoff ? "handoff" : "waiting",
        });
    }
    return items;
}

export interface IFunnelCounts {
    calls: number;
    plans: number;
    paid: number;
}

/** Calls placed, plans accepted, payments cleared. An agent can sit in more than one stage. */
export function funnel(agents: readonly IAgent[]): IFunnelCounts {
    const counts: IFunnelCounts = { calls: 0, plans: 0, paid: 0 };
    for (const agent of agents) {
        if (agent.outcomes.callPlaced) counts.calls += 1;
        if (agent.outcomes.planAccepted) counts.plans += 1;
        if (agent.outcomes.paymentCleared) counts.paid += 1;
    }
    return counts;
}

export interface IActivityItem {
    id: string;
    tenant: string;
    property: string;
    step: TAgentStep;
}

/** One line per agent, in the order calls were loaded (newest activity first). */
export function activity(agents: readonly IAgent[]): IActivityItem[] {
    return agents.map((agent) => ({
        id: agent.id,
        tenant: agent.tenant,
        property: agent.property,
        step: agent.currentStep,
    }));
}
