/**
 * @module artifact-builder/mutations/handlers
 *
 * Pure Chat artifact document mutations (ADR 0034 / 03). Each handler returns a
 * new document or the same reference on no-op. Callers own undo and persistence.
 *
 * Depends on: none (ambient TChatArtifactDocument)
 * Used by: catalog
 */

function mintId(): string {
    return crypto.randomUUID();
}

function cloneDocument(document: TChatArtifactDocument): TChatArtifactDocument {
    return {
        title: document.title,
        weeks: document.weeks.map((week) => ({
            days: week.days.map((day) => ({
                id: day.id,
                title: day.title,
                items: day.items.map((item) => {
                    const next: TArtifactItem = { id: item.id, title: item.title };
                    if (item.notes !== undefined) {
                        next.notes = item.notes;
                    }
                    return next;
                }),
            })),
        })),
    };
}

function weekAt(
    document: TChatArtifactDocument,
    weekIndex: number,
): TArtifactWeekDocument | null {
    return document.weeks[weekIndex] ?? null;
}

function dayInWeek(
    week: TArtifactWeekDocument,
    dayId: string,
): { day: TArtifactDayDocument; dayIndex: number } | null {
    const dayIndex = week.days.findIndex((day) => day.id === dayId);
    if (dayIndex < 0) return null;
    return { day: week.days[dayIndex], dayIndex };
}

/**
 * @param document - Current Chat artifact
 * @param title - New title
 */
export function setTitle(
    document: TChatArtifactDocument,
    title: string,
): TChatArtifactDocument {
    if (document.title === title) return document;
    return { ...document, title };
}

/**
 * @param document - Current Chat artifact
 * @param atIndex - Optional insert index; omit to append
 */
export function addWeek(
    document: TChatArtifactDocument,
    atIndex?: number,
): TChatArtifactDocument {
    const next = cloneDocument(document);
    const week: TArtifactWeekDocument = { days: [] };
    if (atIndex === undefined || atIndex >= next.weeks.length) {
        next.weeks.push(week);
    } else {
        next.weeks.splice(atIndex, 0, week);
    }
    return next;
}

/**
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 */
export function deleteWeek(
    document: TChatArtifactDocument,
    weekIndex: number,
): TChatArtifactDocument | null {
    if (weekIndex < 0 || weekIndex >= document.weeks.length) return null;
    const next = cloneDocument(document);
    next.weeks.splice(weekIndex, 1);
    return next;
}

/**
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param title - Optional day title
 * @param id - Optional day id
 */
export function addDay(
    document: TChatArtifactDocument,
    weekIndex: number,
    title = "",
    id?: string,
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const next = cloneDocument(document);
    next.weeks[weekIndex].days.push({
        id: id ?? mintId(),
        title,
        items: [],
    });
    return next;
}

/**
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param dayId - Day id to remove
 */
export function deleteDay(
    document: TChatArtifactDocument,
    weekIndex: number,
    dayId: string,
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const located = dayInWeek(week, dayId);
    if (!located) return null;
    const next = cloneDocument(document);
    next.weeks[weekIndex].days.splice(located.dayIndex, 1);
    return next;
}

/**
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param dayId - Day id to rename
 * @param title - New title
 */
export function renameDay(
    document: TChatArtifactDocument,
    weekIndex: number,
    dayId: string,
    title: string,
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const located = dayInWeek(week, dayId);
    if (!located) return null;
    if (located.day.title === title) return document;
    const next = cloneDocument(document);
    next.weeks[weekIndex].days[located.dayIndex] = {
        ...next.weeks[weekIndex].days[located.dayIndex],
        title,
    };
    return next;
}

/**
 * Insert or replace an Artifact item by id on a day.
 *
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param dayId - Target day id
 * @param item - Item payload (id optional on insert)
 */
export function upsertItem(
    document: TChatArtifactDocument,
    weekIndex: number,
    dayId: string,
    item: { id?: string; title: string; notes?: string },
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const located = dayInWeek(week, dayId);
    if (!located) return null;

    const next = cloneDocument(document);
    const day = next.weeks[weekIndex].days[located.dayIndex];
    const nextItem: TArtifactItem = {
        id: item.id ?? mintId(),
        title: item.title,
    };
    if (item.notes !== undefined) {
        nextItem.notes = item.notes;
    }

    if (item.id) {
        const existingIndex = day.items.findIndex((row) => row.id === item.id);
        if (existingIndex >= 0) {
            day.items[existingIndex] = nextItem;
            return next;
        }
    }

    day.items.push(nextItem);
    return next;
}

/**
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param dayId - Target day id
 * @param itemId - Item id to remove
 */
export function deleteItem(
    document: TChatArtifactDocument,
    weekIndex: number,
    dayId: string,
    itemId: string,
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const located = dayInWeek(week, dayId);
    if (!located) return null;
    const itemIndex = located.day.items.findIndex((row) => row.id === itemId);
    if (itemIndex < 0) return null;
    const next = cloneDocument(document);
    next.weeks[weekIndex].days[located.dayIndex].items.splice(itemIndex, 1);
    return next;
}

/**
 * Reorder items on a day. `itemIds` must be a full permutation of existing ids.
 *
 * @param document - Current Chat artifact
 * @param weekIndex - 0-based week index
 * @param dayId - Target day id
 * @param itemIds - New order of item ids
 */
export function reorderItems(
    document: TChatArtifactDocument,
    weekIndex: number,
    dayId: string,
    itemIds: string[],
): TChatArtifactDocument | null {
    const week = weekAt(document, weekIndex);
    if (!week) return null;
    const located = dayInWeek(week, dayId);
    if (!located) return null;

    const existingIds = located.day.items.map((row) => row.id);
    if (itemIds.length !== existingIds.length) return null;
    const existingSet = new Set(existingIds);
    if (itemIds.some((id) => !existingSet.has(id))) return null;
    if (new Set(itemIds).size !== itemIds.length) return null;

    const byId = new Map(located.day.items.map((row) => [row.id, row]));
    const next = cloneDocument(document);
    next.weeks[weekIndex].days[located.dayIndex].items = itemIds.map((id) => {
        const row = byId.get(id)!;
        const cloned: TArtifactItem = { id: row.id, title: row.title };
        if (row.notes !== undefined) {
            cloned.notes = row.notes;
        }
        return cloned;
    });
    return next;
}
