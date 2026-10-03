/**
 * @module ActivityFeed
 * Recent agent activity, one line per call, in load order.
 * Depends on: home-derived, agent-floor/agents.
 * Used by: LandlordHome.
 */

import type { TAgentStep } from "@/lib/agent-floor/agents";
import type { IActivityItem } from "@/lib/landlord-home/home-derived";

const HEADING = "text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground";

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

/** Newest calls first. Empty when the landlord has no calls. */
export function ActivityFeed({ items }: { items: readonly IActivityItem[] }) {
    return (
        <section aria-label="Activity" className="space-y-3">
            <h2 className={ HEADING }>Activity</h2>
            { items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity.</p>
            ) : (
                <ul className="space-y-2">
                    { items.map((item) => (
                        <li key={ item.id } className="text-sm">
                            <span className="font-medium">{ item.tenant }</span>
                            <span className="text-muted-foreground">
                                { ` · ${item.property} · ${STEP_LABEL[item.step]}` }
                            </span>
                        </li>
                    )) }
                </ul>
            ) }
        </section>
    );
}
