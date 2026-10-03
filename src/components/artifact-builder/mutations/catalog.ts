/**
 * @module artifact-builder/mutations/catalog
 *
 * Typed Chat artifact mutation catalog (ADR 0034 / 03). Op ids match C3 only.
 *
 * Depends on: defineArtifactMutation, handlers, schemas, types
 * Used by: apply, registry, agentSchema
 */

import { defineArtifactMutation } from "./defineArtifactMutation";
import {
    addDay,
    addWeek,
    deleteDay,
    deleteItem,
    deleteWeek,
    renameDay,
    reorderItems,
    setTitle,
    upsertItem,
} from "./handlers";
import {
    addDaySchema,
    addWeekSchema,
    deleteDaySchema,
    deleteItemSchema,
    deleteWeekSchema,
    renameDaySchema,
    reorderItemsSchema,
    setTitleSchema,
    upsertItemSchema,
} from "./schemas";
import {
    mutationFailure,
    mutationSuccess,
    type TArtifactMutationDefinition,
} from "./types";

export const artifactMutationCatalog: TArtifactMutationDefinition[] = [
    defineArtifactMutation({
        id: "set_title",
        description: "Set the Chat artifact title.",
        schema: setTitleSchema,
        run: (document, args) => mutationSuccess(setTitle(document, args.title)),
    }),
    defineArtifactMutation({
        id: "add_week",
        description: "Append or insert an empty week.",
        schema: addWeekSchema,
        run: (document, args) => mutationSuccess(addWeek(document, args.atIndex)),
    }),
    defineArtifactMutation({
        id: "delete_week",
        description: "Delete a week by 0-based index.",
        schema: deleteWeekSchema,
        run: (document, args) => {
            const next = deleteWeek(document, args.weekIndex);
            if (!next) {
                return mutationFailure(`Week not found: ${args.weekIndex}`);
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "add_day",
        description: "Add an Artifact day to a week.",
        schema: addDaySchema,
        run: (document, args) => {
            const next = addDay(document, args.weekIndex, args.title ?? "", args.id);
            if (!next) {
                return mutationFailure(`Week not found: ${args.weekIndex}`);
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "delete_day",
        description: "Delete an Artifact day by id within a week.",
        schema: deleteDaySchema,
        run: (document, args) => {
            const next = deleteDay(document, args.weekIndex, args.dayId);
            if (!next) {
                return mutationFailure(
                    `Day not found: week ${args.weekIndex}, day ${args.dayId}`,
                );
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "rename_day",
        description: "Rename an Artifact day.",
        schema: renameDaySchema,
        run: (document, args) => {
            const next = renameDay(document, args.weekIndex, args.dayId, args.title);
            if (!next) {
                return mutationFailure(
                    `Day not found: week ${args.weekIndex}, day ${args.dayId}`,
                );
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "upsert_item",
        description: "Insert or update an Artifact item on a day.",
        schema: upsertItemSchema,
        run: (document, args) => {
            const next = upsertItem(document, args.weekIndex, args.dayId, args.item);
            if (!next) {
                return mutationFailure(
                    `Day not found: week ${args.weekIndex}, day ${args.dayId}`,
                );
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "delete_item",
        description: "Delete an Artifact item from a day.",
        schema: deleteItemSchema,
        run: (document, args) => {
            const next = deleteItem(
                document,
                args.weekIndex,
                args.dayId,
                args.itemId,
            );
            if (!next) {
                return mutationFailure(
                    `Item not found: week ${args.weekIndex}, day ${args.dayId}, item ${args.itemId}`,
                );
            }
            return mutationSuccess(next);
        },
    }),
    defineArtifactMutation({
        id: "reorder_items",
        description: "Reorder Artifact items on a day (full id permutation).",
        schema: reorderItemsSchema,
        run: (document, args) => {
            const next = reorderItems(
                document,
                args.weekIndex,
                args.dayId,
                args.itemIds,
            );
            if (!next) {
                return mutationFailure(
                    `Cannot reorder items on week ${args.weekIndex}, day ${args.dayId}`,
                );
            }
            return mutationSuccess(next);
        },
    }),
];

export const artifactMutationCatalogById: Record<string, TArtifactMutationDefinition> =
    Object.fromEntries(artifactMutationCatalog.map((mutation) => [mutation.id, mutation]));

export const agentExposedArtifactMutations = artifactMutationCatalog.filter(
    (mutation) => mutation.agentExposed,
);
