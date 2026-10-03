/**
 * @module MutationProposalCard
 *
 * Always-expanded review card for a Mutation proposal (ADR 0034 / 05).
 * Domain-neutral op summary lines; Reject left, Accept right.
 *
 * Depends on: Button, mutation-proposal recipe type
 * Used by: MessageBubbles
 */
"use client";

import { Button } from "@/components/ui/button";
import { shouldSkipChatInputAutofocus } from "@/components/artifact-builder/utils/chat-keyboard";
import type { TMutationProposalRecipe } from "@/components/artifact-builder/utils/mutation-proposal";

/** Props for the Mutation proposal recipe card. */
export interface IMutationProposalCardProps {
    onAccept?: () => void;
    onReject?: () => void;
    recipe: TMutationProposalRecipe;
    showActions: boolean;
}

/**
 * Focus the visible dashboard chat textarea (Reject).
 */
export function focusDashboardChatInput(): void {
    if (shouldSkipChatInputAutofocus()) return;
    const nodes = document.querySelectorAll<HTMLTextAreaElement>("[data-proxima-chat-input]");
    for (const node of nodes) {
        if (node.offsetParent !== null) {
            node.focus();
            return;
        }
    }
    nodes[0]?.focus();
}

/** Recipe card: Proposed changes + Accept / Reject while open. */
export const MutationProposalCard: React.FC<IMutationProposalCardProps> = ({
    onAccept,
    onReject,
    recipe,
    showActions,
}) => {
    return (
        <div className="w-full pb-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="px-4 py-3">
                    <p className="text-[13px] font-medium text-foreground">
                        Proposed changes
                    </p>
                </div>
                <ul className="flex flex-col gap-2 border-t border-border px-4 py-3">
                    {recipe.lines.map((line, index) => (
                        <li
                            key={`${index}-${line}`}
                            className="text-[13px] text-foreground"
                        >
                            {line}
                        </li>
                    ))}
                </ul>
                {showActions ? (
                    <div className="flex items-center justify-between border-t border-border px-4 py-3">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-red-600 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            onClick={onReject}
                        >
                            Reject
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={onAccept}
                        >
                            Accept
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};
