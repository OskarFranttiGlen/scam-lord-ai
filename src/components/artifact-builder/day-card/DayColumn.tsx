/**
 * @module DayColumn
 * Week column: header + Day cards from Chat artifact document (ADR 0034 / 04).
 * Depends on: DayCard.
 * Used by: ArtifactGrid.
 */

import { DayCard } from "./DayCard";

/** Props for a single week column in the artifact grid. */
interface IProps {
    /** Column header label (e.g. "Week 1"). */
    title: string;
    /** Week index (0-based) this column represents. */
    weekIndex: number;
    /** Nested week from the Chat artifact document. */
    week: TArtifactWeekDocument;
    /** When true (mobile), day cards use fade-in instead of layout animation. */
    isMobile?: boolean;
}

/**
 * Renders one week column of Artifact day cards.
 */
export const DayColumn: React.FC<IProps> = (props) => {
    const {
        title,
        week,
        weekIndex,
        isMobile = false,
    } = props;

    return (
        <div className="flex flex-col gap-2 min-w-0 sm:min-w-[360px] md:min-w-[385px] lg:min-w-[450px]">
            <div className="font-main text-lg px-1 py-2 sticky top-0 z-10 bg-background/90 backdrop-blur-sm">
                {title}
            </div>
            <div className="flex flex-col">
                {week.days.map((day, dayIndex) => (
                    <DayCard
                        key={day.id || `${weekIndex}-${dayIndex}`}
                        day={day}
                        dayOrder={dayIndex + 1}
                        weekIndex={weekIndex}
                        isMobile={isMobile}
                    />
                ))}
                {week.days.length === 0 ? (
                    <div className="text-sm text-muted-foreground font-secondary px-1 py-4">
                        Empty week
                    </div>
                ) : null}
            </div>
        </div>
    );
};
