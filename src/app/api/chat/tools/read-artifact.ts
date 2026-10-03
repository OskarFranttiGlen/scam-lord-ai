/**
 * @module chat/tools/read-artifact
 *
 * Request-start Chat artifact snapshot helpers for `readArtifact` (ADR 0034 / 05).
 * No mid-turn re-fetch; targeting docs use weekIndex + day/item ids.
 *
 * Depends on: zod
 * Used by: tools.ts, tools tests
 */

import { z } from "zod";

import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";

/** Empty input — snapshot comes from tool context / request body. */
export const readArtifactInputSchema = z.object({});

/**
 * Returns a defensive copy of the request-start Chat artifact document.
 *
 * @param document - Snapshot from the chat request body
 */
export function readArtifactSnapshot(
    document: TChatArtifactDocument | undefined,
): TChatArtifactDocument {
    if (!document || typeof document !== "object") {
        return { ...EMPTY_CHAT_ARTIFACT_DOCUMENT, weeks: [] };
    }
    return JSON.parse(JSON.stringify(document)) as TChatArtifactDocument;
}

/**
 * True when the snapshot has at least one week (standalone mutates need a prior read).
 *
 * @param document - Request-start snapshot
 */
export function artifactSnapshotHasContent(
    document: TChatArtifactDocument | undefined,
): boolean {
    return (document?.weeks?.length ?? 0) > 0;
}

/**
 * Model-facing string for `readArtifact` — full JSON plus targeting docs.
 *
 * @param document - Sorted/copied snapshot from {@link readArtifactSnapshot}
 */
export function formatReadArtifactForModel(document: TChatArtifactDocument): string {
    if (document.weeks.length === 0) {
        return (
            "Chat artifact snapshot is empty (no weeks at request start). " +
            "First mutate may create weeks/days/items without a prior read."
        );
    }

    const weekCount = document.weeks.length;
    const dayCount = document.weeks.reduce((n, week) => n + week.days.length, 0);
    const itemCount = document.weeks.reduce(
        (n, week) => n + week.days.reduce((m, day) => m + day.items.length, 0),
        0,
    );

    return (
        `Chat artifact snapshot (${weekCount} week${weekCount === 1 ? "" : "s"}, ` +
        `${dayCount} day${dayCount === 1 ? "" : "s"}, ` +
        `${itemCount} item${itemCount === 1 ? "" : "s"}). ` +
        `Title: ${JSON.stringify(document.title)}. ` +
        "For mutateArtifact: weekIndex is 0-based into weeks[]. " +
        "Target days by dayId and items by itemId from this snapshot (not an earlier turn). " +
        "Call readArtifact in the same turn before mutateArtifact when the artifact already has weeks.\n\n" +
        JSON.stringify(document)
    );
}
