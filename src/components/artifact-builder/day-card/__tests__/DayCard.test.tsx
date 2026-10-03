/**
 * Day card Artifact item rendering (ADR 0034 / 04).
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DayCard } from "../DayCard";
import { ArtifactMutationProvider } from "@/contexts/ArtifactMutationContext";
import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";
import { hashArtifactIdToMarkKey } from "@/components/artifact-builder/mutations/proposal-marks";

const dayWithItems: TArtifactDayDocument = {
    id: "day-a",
    title: "Monday",
    items: [
        { id: "item-1", title: "Pack" },
        { id: "item-2", title: "Call" },
    ],
};

const emptyDay: TArtifactDayDocument = {
    id: "day-b",
    title: "Tuesday",
    items: [],
};

function renderDay(
    day: TArtifactDayDocument,
    proposalMarkKeys: number[] = [],
) {
    return render(
        <ArtifactMutationProvider
            document={EMPTY_CHAT_ARTIFACT_DOCUMENT}
            commitWithUndo={() => undefined}
            setDocumentFromHydrate={() => undefined}
            proposalMarkKeys={proposalMarkKeys}
        >
            <DayCard day={day} dayOrder={1} weekIndex={0} />
        </ArtifactMutationProvider>,
    );
}

describe("DayCard Artifact items", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders item titles only", () => {
        renderDay(dayWithItems);

        expect(screen.getByText("Day 1")).toBeTruthy();
        expect(screen.getByText("Monday")).toBeTruthy();
        const list = screen.getByRole("list", { name: "Artifact items" });
        expect(list.textContent).toContain("Pack");
        expect(list.textContent).toContain("Call");
        expect(screen.queryByText("No items yet")).toBeNull();
    });

    it("allows empty days", () => {
        renderDay(emptyDay);

        expect(screen.getByText("No items yet")).toBeTruthy();
        expect(screen.queryByRole("list", { name: "Artifact items" })).toBeNull();
    });

    it("marks proposal targets by item id hash", () => {
        const markKey = hashArtifactIdToMarkKey("item-1");
        renderDay(dayWithItems, [markKey]);

        const marked = document.querySelector(
            `[data-artifact-mark-key="${markKey}"]`,
        );
        expect(marked?.textContent).toContain("Pack");
        expect(marked?.className).toContain("ring-primary");
    });
});
