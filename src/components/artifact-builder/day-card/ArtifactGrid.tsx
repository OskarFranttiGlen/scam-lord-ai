"use client";

/**
 * @module ArtifactGrid
 * Week grid driven by Chat artifact document (ADR 0034 / 04). No exercise dialogs.
 * Depends on: DayColumn, Button, document-grid.
 * Used by: ProgramGrid.
 */

import { useState } from "react";
import { DayColumn } from "./DayColumn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentWeekCount } from "./document-grid";

/** Props for the artifact week grid. */
interface IProps {
    /** Live Chat artifact document. */
    document: TChatArtifactDocument;
    /** When true, single-week view with prev/next. */
    isMobile: boolean;
}

/**
 * Renders week columns (or a single mobile week with prev/next).
 */
export const ArtifactGrid: React.FC<IProps> = (props) => {
    const { document, isMobile } = props;

    const numberOfWeeks = documentWeekCount(document);
    const [mobileWeek, setMobileWeek] = useState(0);
    const safeMobileWeek = Math.min(
        Math.max(0, mobileWeek),
        Math.max(0, numberOfWeeks - 1),
    );

    if (isMobile) {
        const week = document.weeks[safeMobileWeek] ?? { days: [] };
        return (
            <div className="flex flex-col gap-2 w-full px-2">
                <div className="flex flex-row items-center justify-between gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={safeMobileWeek <= 0}
                        onClick={() => setMobileWeek((w) => Math.max(0, w - 1))}
                        aria-label="Previous week"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-main text-sm">
                        Week {safeMobileWeek + 1} of {Math.max(numberOfWeeks, 1)}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={safeMobileWeek >= numberOfWeeks - 1}
                        onClick={() =>
                            setMobileWeek((w) =>
                                Math.min(Math.max(numberOfWeeks - 1, 0), w + 1),
                            )
                        }
                        aria-label="Next week"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <DayColumn
                    title={`Week ${safeMobileWeek + 1}`}
                    weekIndex={safeMobileWeek}
                    week={week}
                    isMobile
                />
            </div>
        );
    }

    return (
        <div className="flex flex-row gap-4 overflow-x-auto px-2 pb-4">
            {document.weeks.map((week, weekIndex) => (
                <DayColumn
                    key={weekIndex}
                    title={`Week ${weekIndex + 1}`}
                    weekIndex={weekIndex}
                    week={week}
                    isMobile={false}
                />
            ))}
        </div>
    );
};
