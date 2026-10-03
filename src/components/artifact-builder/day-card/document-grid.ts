/**
 * @module artifact-builder/day-card/document-grid
 *
 * Pure helpers for rendering a Chat artifact document as week/day columns
 * (ADR 0034 / 04). No fitness / exercise / set fields.
 *
 * Depends on: (none)
 * Used by: ProgramGrid, Dashboard dirty checks, day-card tests
 */

/**
 * True when any Artifact day has at least one Artifact item.
 *
 * @param document - Live Chat artifact document
 */
export function documentHasArtifactItems(
    document: TChatArtifactDocument,
): boolean {
    return document.weeks.some((week) =>
        week.days.some((day) => day.items.length > 0),
    );
}

/**
 * Week count for column layout. Empty documents render zero weeks.
 *
 * @param document - Live Chat artifact document
 */
export function documentWeekCount(document: TChatArtifactDocument): number {
    return document.weeks.length;
}
