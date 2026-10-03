/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/hooks/supabase";
import {
    createArtifact,
    getArtifactById,
    parseChatArtifactDocument,
    saveArtifactDocument,
} from "@/api/artifacts";

function asDb(mock: unknown): SupabaseClient<Database> {
    return mock as SupabaseClient<Database>;
}

const sampleDocument: TChatArtifactDocument = {
    title: "Trip plan",
    weeks: [
        {
            days: [
                {
                    id: "day-1",
                    title: "Monday",
                    items: [{ id: "item-1", title: "Pack", notes: "bags" }],
                },
            ],
        },
    ],
};

describe("parseChatArtifactDocument", () => {
    it("returns empty document for nullish input", () => {
        expect(parseChatArtifactDocument(null)).toEqual({ title: "", weeks: [] });
        expect(parseChatArtifactDocument(undefined)).toEqual({ title: "", weeks: [] });
    });

    it("parses weeks/days/items", () => {
        expect(parseChatArtifactDocument(sampleDocument)).toEqual(sampleDocument);
    });
});

describe("getArtifactById", () => {
    const maybeSingle = vi.fn();
    const eqId = vi.fn(() => ({ maybeSingle }));
    const eqUser = vi.fn(() => ({ eq: eqId }));
    const select = vi.fn(() => ({ eq: eqUser }));
    const from = vi.fn(() => ({ select }));

    beforeEach(() => {
        vi.clearAllMocks();
        eqId.mockReturnValue({ maybeSingle });
        eqUser.mockReturnValue({ eq: eqId });
        select.mockReturnValue({ eq: eqUser });
        from.mockReturnValue({ select });
    });

    it("reads artifact JSON without touching fitness tables", async () => {
        maybeSingle.mockResolvedValueOnce({
            data: {
                id: "art-1",
                user_id: "user-1",
                title: "Trip plan",
                document: sampleDocument,
                created_at: "2026-09-23T00:00:00Z",
                updated_at: "2026-09-23T00:00:00Z",
            },
            error: null,
        });

        const row = await getArtifactById(asDb({ from }), "user-1", "art-1");

        expect(from).toHaveBeenCalledWith("artifacts");
        expect(from).not.toHaveBeenCalledWith("programs");
        expect(row).toEqual({
            id: "art-1",
            user_id: "user-1",
            title: "Trip plan",
            document: sampleDocument,
            created_at: "2026-09-23T00:00:00Z",
            updated_at: "2026-09-23T00:00:00Z",
        });
    });

    it("returns null when missing", async () => {
        maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        expect(await getArtifactById(asDb({ from }), "user-1", "missing")).toBeNull();
    });
});

describe("createArtifact / saveArtifactDocument", () => {
    const maybeSingle = vi.fn();
    const select = vi.fn(() => ({ maybeSingle }));
    const insert = vi.fn(() => ({ select }));
    const eqId = vi.fn(() => ({ select }));
    const eqUser = vi.fn(() => ({ eq: eqId }));
    const update = vi.fn(() => ({ eq: eqUser }));
    const from = vi.fn(() => ({ insert, update }));

    beforeEach(() => {
        vi.clearAllMocks();
        select.mockReturnValue({ maybeSingle });
        insert.mockReturnValue({ select });
        eqId.mockReturnValue({ select });
        eqUser.mockReturnValue({ eq: eqId });
        update.mockReturnValue({ eq: eqUser });
        from.mockReturnValue({ insert, update });
    });

    it("inserts JSON into artifacts only", async () => {
        maybeSingle.mockResolvedValueOnce({
            data: {
                id: "art-2",
                user_id: "user-1",
                title: "Trip plan",
                document: sampleDocument,
                created_at: "2026-09-23T00:00:00Z",
                updated_at: "2026-09-23T00:00:00Z",
            },
            error: null,
        });

        const row = await createArtifact(asDb({ from }), "user-1", sampleDocument, {
            id: "art-2",
        });

        expect(from).toHaveBeenCalledWith("artifacts");
        expect(from).not.toHaveBeenCalledWith("programs");
        expect(insert).toHaveBeenCalledWith({
            user_id: "user-1",
            title: "Trip plan",
            document: sampleDocument,
            id: "art-2",
        });
        expect(row?.id).toBe("art-2");
        expect(row?.document).toEqual(sampleDocument);
    });

    it("updates document JSON on artifacts only", async () => {
        const nextDoc: TChatArtifactDocument = {
            title: "Updated",
            weeks: [],
        };
        maybeSingle.mockResolvedValueOnce({
            data: {
                id: "art-2",
                user_id: "user-1",
                title: "Updated",
                document: nextDoc,
                created_at: "2026-09-23T00:00:00Z",
                updated_at: "2026-09-23T01:00:00Z",
            },
            error: null,
        });

        const row = await saveArtifactDocument(
            asDb({ from }),
            "user-1",
            "art-2",
            nextDoc,
        );

        expect(from).toHaveBeenCalledWith("artifacts");
        expect(update).toHaveBeenCalledWith({
            title: "Updated",
            document: nextDoc,
        });
        expect(row?.document.title).toBe("Updated");
    });
});
