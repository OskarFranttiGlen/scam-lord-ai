import { cn } from "@/lib/utils";

export interface ITranscriptTurn {
    speaker: "agent" | "tenant";
    text: string;
    time: string;
    isPlan?: boolean;
}

export interface ITranscriptProps {
    turns: ITranscriptTurn[];
    className?: string;
}

export function Transcript({ turns, className }: ITranscriptProps) {
    return (
        <div className={cn("flex flex-col gap-4", className)}>
            {turns.map((turn, index) => {
                const isAgent = turn.speaker === "agent";
                return (
                    <div
                        key={`${turn.time}-${index}`}
                        className={cn(
                            "max-w-[85%] rounded-lg px-4 py-3 text-base",
                            isAgent
                                ? "self-start border border-border bg-card"
                                : "self-end bg-muted",
                            turn.isPlan && "border-2 border-primary",
                        )}
                    >
                        <p className="mb-1 text-[13px] font-semibold uppercase tracking-[1.5px] text-muted-foreground">
                            {isAgent ? "RentRecovery · AI" : "Tenant"}
                            <span className="ml-2 font-normal normal-case tracking-normal">
                                {turn.time}
                            </span>
                        </p>
                        <p>{turn.text}</p>
                    </div>
                );
            })}
        </div>
    );
}
