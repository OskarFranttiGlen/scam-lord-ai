/**
 * @module MetricsBand
 * Home tiles. Money and pace come in as props; missing values read as —.
 * Depends on: invoice-row formatMoney.
 * Used by: LandlordHome.
 */

import { formatMoney } from "@/components/ui/invoice-row";

function shown(value: number | null, format: (value: number) => string): string {
    return value == null ? "—" : format(value);
}

function formatDuration(minutes: number): string {
    const roundedMin = Math.round(minutes);
    if (roundedMin < 90) return `${roundedMin} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} hr`;
    const days = Math.round(minutes / 1440);
    return days === 1 ? "1 day" : `${days} days`;
}

function formatCount(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-[1.25rem] border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                { label }
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{ value }</p>
        </div>
    );
}

export interface IMetricsBandProps {
    collectionRate?: number | null;
    medianResolutionMinutes?: number | null;
    averageTouches?: number | null;
    recovered?: number | null;
    stillOverdue?: number | null;
    promised?: number | null;
}

/** Collection pace first, then the money tiles. Null is an em dash until Stripe sync. */
export function MetricsBand({
    collectionRate = null,
    medianResolutionMinutes = null,
    averageTouches = null,
    recovered = null,
    stillOverdue = null,
    promised = null,
}: IMetricsBandProps) {
    return (
        <section aria-label="Metrics" className="grid min-w-0 grid-cols-2 gap-3">
            <Tile label="Rent collection rate" value={ shown(collectionRate, (rate) => `${Math.round(rate * 100)}%`) } />
            <Tile label="Median speed of resolution" value={ shown(medianResolutionMinutes, formatDuration) } />
            <Tile label="Average touches to collect" value={ shown(averageTouches, formatCount) } />
            <Tile label="Recovered" value={ shown(recovered, formatMoney) } />
            <Tile label="Still overdue" value={ shown(stillOverdue, formatMoney) } />
            <Tile label="Promised" value={ shown(promised, formatMoney) } />
        </section>
    );
}
