/**
 * @module MetricsBand
 * Four Home tiles. Money and speed come in as props; missing values read as —.
 * Depends on: invoice-row formatMoney.
 * Used by: LandlordHome.
 */

import { formatMoney } from "@/components/ui/invoice-row";

function shown(value: number | null, format: (value: number) => string): string {
    return value == null ? "—" : format(value);
}

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-[1.25rem] border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                { label }
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{ value }</p>
        </div>
    );
}

export interface IMetricsBandProps {
    recovered?: number | null;
    stillOverdue?: number | null;
    promised?: number | null;
    medianMinutes?: number | null;
}

/** Recovered, still overdue, promised, and median minutes. Null is an em dash until Stripe sync. */
export function MetricsBand({
    recovered = null,
    stillOverdue = null,
    promised = null,
    medianMinutes = null,
}: IMetricsBandProps) {
    return (
        <section aria-label="Metrics" className="grid min-w-0 grid-cols-2 gap-3">
            <Tile label="Recovered" value={ shown(recovered, formatMoney) } />
            <Tile label="Still overdue" value={ shown(stillOverdue, formatMoney) } />
            <Tile label="Promised" value={ shown(promised, formatMoney) } />
            <Tile label="Median minutes" value={ shown(medianMinutes, (minutes) => `${minutes} min`) } />
        </section>
    );
}
