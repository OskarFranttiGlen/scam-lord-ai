/**
 * Chat artifact document grid helpers (ADR 0034 / 04).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";
import {
    documentHasArtifactItems,
    documentWeekCount,
} from "../document-grid";

describe("document-grid", () => {
    it("treats empty documents as no weeks and no items", () => {
        expect(documentWeekCount(EMPTY_CHAT_ARTIFACT_DOCUMENT)).toBe(0);
        expect(documentHasArtifactItems(EMPTY_CHAT_ARTIFACT_DOCUMENT)).toBe(false);
    });

    it("counts weeks and detects Artifact items", () => {
        const document: TChatArtifactDocument = {
            title: "Trip",
            weeks: [
                {
                    days: [
                        { id: "d1", title: "Mon", items: [] },
                        { id: "d2", title: "Tue", items: [{ id: "i1", title: "Pack" }] },
                    ],
                },
                { days: [] },
            ],
        };
        expect(documentWeekCount(document)).toBe(2);
        expect(documentHasArtifactItems(document)).toBe(true);
        expect(
            documentHasArtifactItems({
                title: "",
                weeks: [{ days: [{ id: "d1", title: "Mon", items: [] }] }],
            }),
        ).toBe(false);
    });
});
