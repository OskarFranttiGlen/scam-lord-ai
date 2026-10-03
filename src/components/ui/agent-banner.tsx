import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge, type TStatus } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export interface IAgentBannerProps {
    headline: string;
    detail: string;
    status: TStatus;
    className?: string;
}

export function AgentBanner({ headline, detail, status, className }: IAgentBannerProps) {
    return (
        <Alert
            className={cn(
                "flex items-center justify-between gap-4 border-0 bg-brand-ink text-brand-mint dark:bg-brand-mint dark:text-brand-ink [&>svg]:hidden",
                "rounded-[1.25rem] px-5 py-4",
                className,
            )}
        >
            <div className="min-w-0">
                <AlertTitle className="mb-1 font-main text-xl leading-none tracking-tight">
                    {headline}
                </AlertTitle>
                <AlertDescription className="text-sm">{detail}</AlertDescription>
            </div>
            <StatusBadge status={status} />
        </Alert>
    );
}
