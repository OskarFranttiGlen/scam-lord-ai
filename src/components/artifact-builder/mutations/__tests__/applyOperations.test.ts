/**
 * Chat artifact mutation apply/reorder/delete (ADR 0034 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";
import {
    applyOperations,
    artifactMutationCatalog,
    findWeekIndexForArtifactMarkKey,
    hashArtifactIdToMarkKey,
    isProposalMarkedId,
    mutateArtifactInputSchema,
} from "@/components/artifact-builder/mutations";

const baseDoc = (): TChatArtifactDocument => ({
    title: "Plan",
    weeks: [
        {
            days: [
                {
                    id: "day-a",
                    title: "Monday",
                    items: [
                        { id: "item-1", title: "Pack" },
                        { id: "item-2", title: "Call" },
                        { id: "item-3", title: "Buy" },
                    ],
                },
                {
                    id: "day-b",
                    title: "Tuesday",
                    items: [{ id: "item-9", title: "Rest" }],
                },
            ],
        },
    ],
});

describe("artifact mutation catalog", () => {
    it("exposes only C3 op ids", () => {
        expect(artifactMutationCatalog.map((m) => m.id).sort()).toEqual([
            "add_day",
            "add_week",
            "delete_day",
            "delete_item",
            "delete_week",
            "rename_day",
            "reorder_items",
            "set_title",
            "upsert_item",
        ]);
    });
});

describe("applyOperations", () => {
    it("applies set_title, add_week, add_day", () => {
        const result = applyOperations(EMPTY_CHAT_ARTIFACT_DOCUMENT, [
            { op: "set_title", title: "Trip" },
            { op: "add_week" },
            { op: "add_day", weekIndex: 0, title: "Mon", id: "d1" },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.title).toBe("Trip");
        expect(result.document.weeks).toHaveLength(1);
        expect(result.document.weeks[0].days).toEqual([
            { id: "d1", title: "Mon", items: [] },
        ]);
    });

    it("deletes a day and leaves sibling days", () => {
        const result = applyOperations(baseDoc(), [
            { op: "delete_day", weekIndex: 0, dayId: "day-a" },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.weeks[0].days.map((d) => d.id)).toEqual(["day-b"]);
    });

    it("renames a day", () => {
        const result = applyOperations(baseDoc(), [
            { op: "rename_day", weekIndex: 0, dayId: "day-b", title: "Tue" },
        ]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.document.weeks[0].days[1].title).toBe("Tue");
    });

    it("upserts, reorders, and deletes items", () => {
        const upserted = applyOperations(baseDoc(), [
            {
                op: "upsert_item",
                weekIndex: 0,
                dayId: "day-a",
                item: { id: "item-2", title: "Call mom", notes: "pm" },
            },
            {
                op: "upsert_item",
                weekIndex: 0,
                dayId: "day-a",
                item: { id: "item-4", title: "Ship" },
            },
        ]);
        expect(upserted.ok).toBe(true);
        if (!upserted.ok) return;
        expect(upserted.document.weeks[0].days[0].items).toEqual([
            { id: "item-1", title: "Pack" },
            { id: "item-2", title: "Call mom", notes: "pm" },
            { id: "item-3", title: "Buy" },
            { id: "item-4", title: "Ship" },
        ]);

        const reordered = applyOperations(upserted.document, [
            {
                op: "reorder_items",
                weekIndex: 0,
                dayId: "day-a",
                itemIds: ["item-4", "item-1", "item-3", "item-2"],
            },
        ]);
        expect(reordered.ok).toBe(true);
        if (!reordered.ok) return;
        expect(reordered.document.weeks[0].days[0].items.map((i) => i.id)).toEqual([
            "item-4",
            "item-1",
            "item-3",
            "item-2",
        ]);

        const deleted = applyOperations(reordered.document, [
            { op: "delete_item", weekIndex: 0, dayId: "day-a", itemId: "item-1" },
        ]);
        expect(deleted.ok).toBe(true);
        if (!deleted.ok) return;
        expect(deleted.document.weeks[0].days[0].items.map((i) => i.id)).toEqual([
            "item-4",
            "item-3",
            "item-2",
        ]);
    });

    it("fail-all rolls back the original document on mid-batch failure", () => {
        const original = baseDoc();
        const result = applyOperations(original, [
            { op: "set_title", title: "Changed" },
            { op: "delete_day", weekIndex: 0, dayId: "missing" },
            { op: "add_week" },
        ]);
        expect(result.ok).toBe(false);
        if (result.ok === true) return;
        expect(result.document).toBe(original);
        expect(result.document.title).toBe("Plan");
        expect(result.failures).toEqual([
            {
                index: 1,
                op: "delete_day",
                reason: "Day not found: week 0, day missing",
            },
        ]);
    });

    it("rejects reorder when itemIds are not a full permutation", () => {
        const result = applyOperations(baseDoc(), [
            {
                op: "reorder_items",
                weekIndex: 0,
                dayId: "day-a",
                itemIds: ["item-1", "item-2"],
            },
        ]);
        expect(result.ok).toBe(false);
        if (result.ok === true) return;
        expect(result.document).toEqual(baseDoc());
    });

    it("deletes a week", () => {
        const withTwoWeeks = applyOperations(baseDoc(), [{ op: "add_week" }]);
        expect(withTwoWeeks.ok).toBe(true);
        if (!withTwoWeeks.ok) return;
        const deleted = applyOperations(withTwoWeeks.document, [
            { op: "delete_week", weekIndex: 0 },
        ]);
        expect(deleted.ok).toBe(true);
        if (!deleted.ok) return;
        expect(deleted.document.weeks).toHaveLength(1);
        expect(deleted.document.weeks[0].days).toEqual([]);
    });
});

describe("mutateArtifactInputSchema", () => {
    it("accepts rename_day", () => {
        const parsed = mutateArtifactInputSchema.safeParse({
            operations: [
                { op: "rename_day", weekIndex: 0, dayId: "day-a", title: "Mon" },
            ],
        });
        expect(parsed.success).toBe(true);
    });

    it("rejects unknown ops outside the C3 catalog", () => {
        const parsed = mutateArtifactInputSchema.safeParse({
            operations: [{ op: "not_a_catalog_op" }],
        });
        expect(parsed.success).toBe(false);
    });
});

describe("proposal mark jump targets", () => {
    it("resolves week index from item and day id hashes", () => {
        const doc = baseDoc();
        expect(
            findWeekIndexForArtifactMarkKey(doc, hashArtifactIdToMarkKey("item-2")),
        ).toBe(0);
        expect(
            findWeekIndexForArtifactMarkKey(doc, hashArtifactIdToMarkKey("day-b")),
        ).toBe(0);
        expect(findWeekIndexForArtifactMarkKey(doc, 1)).toBeNull();
        expect(isProposalMarkedId("item-1", [hashArtifactIdToMarkKey("item-1")])).toBe(true);
        expect(isProposalMarkedId("item-1", [])).toBe(false);
    });
});
