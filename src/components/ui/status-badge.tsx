import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const STATUS = {
    overdue: { label: "Overdue", token: "overdue" },
    "payment-failed": { label: "Payment failed", token: "overdue" },
    "in-progress": { label: "In progress", token: "active" },
    "waiting-on-person": { label: "Waiting on a person", token: "waiting" },
    "waiting-on-payment": { label: "Waiting on payment", token: "waiting" },
    "plan-active": { label: "Plan active", token: "paid" },
    paid: { label: "Paid", token: "paid" },
} as const;

export type TStatus = keyof typeof STATUS;

const TOKEN_CLASS = {
    paid: "bg-status-paid text-status-paid-foreground hover:bg-status-paid",
    overdue: "bg-status-overdue text-status-overdue-foreground hover:bg-status-overdue",
    waiting: "bg-status-waiting text-status-waiting-foreground hover:bg-status-waiting",
    active: "bg-status-active text-status-active-foreground hover:bg-status-active",
} as const;

export interface IStatusBadgeProps {
    status: TStatus;
    className?: string;
}

export function StatusBadge({ status, className }: IStatusBadgeProps) {
    const { label, token } = STATUS[status];
    return (
        <Badge
            className={cn(
                "rounded-full border-transparent px-3 py-1.5 text-sm font-semibold shadow-none",
                TOKEN_CLASS[token],
                className,
            )}
        >
            {label}
        </Badge>
    );
}
