"use client";

/**
 * @module DayCard
 * Artifact day card: title + ordered Artifact item lines (ADR 0034 / 04).
 * Proposal marks key off item/day ids via hashArtifactIdToMarkKey.
 * Depends on: framer-motion, Card, theme, ArtifactMutationContext, proposal-marks.
 * Used by: DayColumn.
 */

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { useTheme } from "next-themes";
import { useProposalMarkKeys } from "@/contexts/ArtifactMutationContext";
import {
    hashArtifactIdToMarkKey,
    isProposalMarkedId,
} from "@/components/artifact-builder/mutations/proposal-marks";

/** Props for a single day card within a week column. */
interface IProps {
    /** Nested day from the Chat artifact document. */
    day: TArtifactDayDocument;
    /** 1-based day order within the week (display only). */
    dayOrder: number;
    /** Week index (0-based) this day belongs to. */
    weekIndex: number;
    /** When true (mobile), use fade-in instead of layout animation. */
    isMobile?: boolean;
}

/**
 * Renders one Artifact day: Day N header + item titles (empty days allowed).
 */
export const DayCard: React.FC<IProps> = (props) => {
    const {
        day,
        dayOrder,
        weekIndex,
        isMobile = false,
    } = props;

    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const proposalMarkKeys = useProposalMarkKeys();
    const dayMarkKey = hashArtifactIdToMarkKey(day.id);
    const dayMarked = isProposalMarkedId(day.id, proposalMarkKeys);

    const baseBorder = isDark
        ? "border-extraDarkGray bg-extraDarkGray shadow-xl shadow-black/20"
        : "border-gray-100 bg-lightGray shadow-lg shadow-gray-200/50";
    const markBorder = "border-primary bg-lightGray dark:bg-extraDarkGray shadow-lg";

    return (
        <motion.div
            layout={!isMobile}
            layoutId={isMobile ? undefined : `${day.id}-${weekIndex}`}
            initial={isMobile ? { opacity: 0 } : false}
            animate={isMobile ? { opacity: 1 } : undefined}
            transition={isMobile ? { duration: 0.2 } : undefined}
            className="rounded gap-4 w-full max-w-full"
            data-artifact-mark-key={day.id ? String(dayMarkKey) : undefined}
        >
            <Card
                className={`border-[3px] w-full max-w-full py-4 sm:pt-2 px-1 sm:px-0 sm:min-w-[360px] sm:max-w-[360px] md:min-w-[385px] md:max-w-[385px] lg:min-w-[450px] lg:max-w-[450px] my-2 box-border dark:border-extraDarkGray dark:bg-extraDarkGray dark:shadow-xl dark:shadow-black/20 ${
                    dayMarked ? markBorder : baseBorder
                }`}
            >
                <div className="flex flex-row justify-between items-center px-3 py-1">
                    <div className="font-main text-lg flex flex-row whitespace-nowrap items-center gap-2">
                        Day {dayOrder}
                    </div>
                    <div className="font-secondary text-md min-w-0 flex-1 truncate px-4">
                        {day.title}
                    </div>
                </div>
                <div className="mt-2 border-t border-gray-200 dark:border-darkGray px-3 py-2">
                    {day.items.length === 0 ? (
                        <div className="py-4 text-sm text-muted-foreground font-secondary">
                            No items yet
                        </div>
                    ) : (
                        <ul className="flex flex-col gap-1 py-2" aria-label="Artifact items">
                            {day.items.map((item) => {
                                const itemMarkKey = hashArtifactIdToMarkKey(item.id);
                                const itemMarked = isProposalMarkedId(item.id, proposalMarkKeys);
                                return (
                                    <li
                                        key={item.id || `${day.id}-${item.title}`}
                                        data-artifact-mark-key={
                                            item.id ? String(itemMarkKey) : undefined
                                        }
                                        className={`font-secondary text-sm truncate rounded px-2 py-1.5 ${
                                            itemMarked
                                                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                                                : "text-foreground"
                                        }`}
                                    >
                                        {item.title || "Untitled"}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </Card>
        </motion.div>
    );
};
