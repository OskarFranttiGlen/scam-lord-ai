import { StatusBadge, type TStatus } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export function formatMoney(amount: number): string {
    return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface IInvoiceRowProps {
    tenant: string;
    property: string;
    dueDate: string;
    amount: number;
    status?: TStatus;
    className?: string;
}

export function InvoiceRowHeader({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "grid grid-cols-[1fr_auto_auto] gap-4 bg-muted px-4 py-3 text-[13px] font-semibold uppercase tracking-[1.5px] text-muted-foreground",
                className,
            )}
        >
            <span>Tenancy</span>
            <span className="text-right">Amount</span>
            <span>Status</span>
        </div>
    );
}

export function InvoiceRow({
    tenant,
    property,
    dueDate,
    amount,
    status,
    className,
}: IInvoiceRowProps) {
    return (
        <div
            className={cn(
                "grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-4 py-4",
                className,
            )}
        >
            <div className="min-w-0">
                <p className="truncate text-base font-semibold">{tenant}</p>
                <p className="truncate text-sm text-muted-foreground">{property}</p>
                <p className="text-sm text-muted-foreground">{dueDate}</p>
            </div>
            <p className="text-right text-lg font-semibold tabular-nums">
                {formatMoney(amount)}
            </p>
            {status ? <StatusBadge status={status} /> : <span />}
        </div>
    );
}
