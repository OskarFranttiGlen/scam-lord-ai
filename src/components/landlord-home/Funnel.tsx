/**
 * @module Funnel
 * Calls, plans, and paid counts. Zeros are a valid empty portfolio.
 * Depends on: home-derived.
 * Used by: LandlordHome.
 */

import type { IFunnelCounts } from "@/lib/landlord-home/home-derived";

const HEADING = "text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground";

const STAGES = [
    ["Calls", "calls"],
    ["Plans", "plans"],
    ["Paid", "paid"],
] as const;

/** Three stages from call and plan outcomes. Bars scale to the largest count. */
export function Funnel({ counts }: { counts: IFunnelCounts }) {
    const scale = Math.max(counts.calls, counts.plans, counts.paid, 1);

    return (
        <section aria-label="Funnel" className="space-y-3">
            <h2 className={ HEADING }>Funnel</h2>
            <ol className="space-y-2">
                { STAGES.map(([label, key]) => (
                    <li key={ key } className="grid grid-cols-[4.5rem_1fr_2rem] items-center gap-3 text-sm">
                        <span>{ label }</span>
                        <span className="h-2 overflow-hidden rounded-full bg-muted">
                            <span
                                className="block h-full bg-primary"
                                style={ { width: `${(counts[key] / scale) * 100}%` } }
                            />
                        </span>
                        <span className="text-right tabular-nums">{ counts[key] }</span>
                    </li>
                )) }
            </ol>
        </section>
    );
}
