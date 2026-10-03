/**
 * @module artifact-builder/mutations/proposal-marks
 *
 * Collect Mutation proposal mark keys after Accept (ADR 0034 / 03–04).
 * Keys hash Artifact item / day ids; Day cards expose matching
 * `data-artifact-mark-key` jump targets.
 *
 * Depends on: schemas
 * Used by: proposal Accept path, ArtifactMutationContext consumers, DayCard
 */

import type { TArtifactOperation } from "./schemas";

/** Stable positive int from a string id (FNV-1a 32-bit). */
export function hashArtifactIdToMarkKey(id: string): number {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/**
 * True when this Artifact item or day id is in the live mark set.
 *
 * @param id - Item or day id
 * @param markKeys - Live proposal mark keys
 */
export function isProposalMarkedId(
    id: string | undefined,
    markKeys: ReadonlySet<number> | readonly number[],
): boolean {
    if (!id) {
        return false;
    }
    const key = hashArtifactIdToMarkKey(id);
    const set = markKeys instanceof Set ? markKeys : new Set(markKeys);
    return set.has(key);
}

/**
 * Week index for a mark key (item or day). Used by proposal jump.
 *
 * @param document - Live Chat artifact document
 * @param markKey - Hash from {@link hashArtifactIdToMarkKey}
 */
export function findWeekIndexForArtifactMarkKey(
    document: TChatArtifactDocument,
    markKey: number,
): number | null {
    for (let weekIndex = 0; weekIndex < document.weeks.length; weekIndex++) {
        const week = document.weeks[weekIndex];
        for (const day of week.days) {
            if (hashArtifactIdToMarkKey(day.id) === markKey) {
                return weekIndex;
            }
            for (const item of day.items) {
                if (hashArtifactIdToMarkKey(item.id) === markKey) {
                    return weekIndex;
                }
            }
        }
    }
    return null;
}

/**
 * Mark keys for items/days touched by a successful Accept batch.
 *
 * @param operations - Ops that were applied
 * @param after - Document after apply
 */
export function collectArtifactProposalMarkKeys(
    operations: readonly TArtifactOperation[],
    after: TChatArtifactDocument,
): number[] {
    const keys = new Set<number>();

    for (const operation of operations) {
        switch (operation.op) {
            case "upsert_item": {
                const day = after.weeks[operation.weekIndex]?.days.find(
                    (row) => row.id === operation.dayId,
                );
                const itemId = operation.item.id
                    ?? day?.items.find((row) => row.title === operation.item.title)?.id;
                if (itemId) {
                    keys.add(hashArtifactIdToMarkKey(itemId));
                }
                break;
            }
            case "delete_item":
            case "reorder_items":
                keys.add(hashArtifactIdToMarkKey(operation.dayId));
                break;
            case "add_day":
            case "rename_day":
            case "delete_day":
                if ("dayId" in operation && typeof operation.dayId === "string") {
                    keys.add(hashArtifactIdToMarkKey(operation.dayId));
                } else if (operation.op === "add_day") {
                    const week = after.weeks[operation.weekIndex];
                    const lastDay = week?.days[week.days.length - 1];
                    if (lastDay) {
                        keys.add(hashArtifactIdToMarkKey(lastDay.id));
                    }
                }
                break;
            default:
                break;
        }
    }

    return Array.from(keys);
}
