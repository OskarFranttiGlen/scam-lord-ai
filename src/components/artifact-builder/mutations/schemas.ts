/**
 * @module artifact-builder/mutations/schemas
 *
 * Zod schemas for Chat artifact mutation ops (ADR 0034 / 03). Zod-only —
 * safe for server imports. No exercise/set/Hevy fields.
 *
 * Depends on: zod
 * Used by: catalog, apply, agentSchema, mutateArtifact tool (slice 5)
 */

import { z } from "zod";

const weekIndexSchema = z
    .number()
    .int()
    .nonnegative()
    .describe("0-based week index in document.weeks[].");

const dayIdSchema = z.string().min(1).describe("Artifact day id within the week.");

const itemIdSchema = z.string().min(1).describe("Artifact item id within the day.");

export const setTitleSchema = z.object({
    op: z.literal("set_title"),
    title: z.string().describe("Chat artifact title."),
});

export const addWeekSchema = z.object({
    op: z.literal("add_week"),
    atIndex: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Optional insert index; omit to append."),
});

export const deleteWeekSchema = z.object({
    op: z.literal("delete_week"),
    weekIndex: weekIndexSchema,
});

export const addDaySchema = z.object({
    op: z.literal("add_day"),
    weekIndex: weekIndexSchema,
    title: z.string().optional().describe("Optional day title; default empty."),
    id: z.string().min(1).optional().describe("Optional day id; minted when omitted."),
});

export const deleteDaySchema = z.object({
    op: z.literal("delete_day"),
    weekIndex: weekIndexSchema,
    dayId: dayIdSchema,
});

export const renameDaySchema = z.object({
    op: z.literal("rename_day"),
    weekIndex: weekIndexSchema,
    dayId: dayIdSchema,
    title: z.string().describe("New Artifact day title."),
});

const artifactItemPayloadSchema = z.object({
    id: z.string().min(1).optional().describe("Item id; minted on insert when omitted."),
    title: z.string().min(1).describe("Artifact item title."),
    notes: z.string().optional(),
});

export const upsertItemSchema = z.object({
    op: z.literal("upsert_item"),
    weekIndex: weekIndexSchema,
    dayId: dayIdSchema,
    item: artifactItemPayloadSchema,
});

export const deleteItemSchema = z.object({
    op: z.literal("delete_item"),
    weekIndex: weekIndexSchema,
    dayId: dayIdSchema,
    itemId: itemIdSchema,
});

export const reorderItemsSchema = z.object({
    op: z.literal("reorder_items"),
    weekIndex: weekIndexSchema,
    dayId: dayIdSchema,
    itemIds: z
        .array(itemIdSchema)
        .min(1)
        .describe("Full permutation of the day's item ids in the new order."),
});

export const artifactOperationSchema = z.discriminatedUnion("op", [
    setTitleSchema,
    addWeekSchema,
    deleteWeekSchema,
    addDaySchema,
    deleteDaySchema,
    renameDaySchema,
    upsertItemSchema,
    deleteItemSchema,
    reorderItemsSchema,
]);

export type TArtifactOperation = z.infer<typeof artifactOperationSchema>;
