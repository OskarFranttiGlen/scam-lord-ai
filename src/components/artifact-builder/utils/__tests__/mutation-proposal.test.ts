/**
 * Mutation proposal + empty-land helpers (ADR 0034 / 05).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";

import {
    acceptMutationProposal,
    buildMutationProposalRecipe,
    collectMutationProposal,
    tryLandEmptyArtifactMutations,
    type TProposalThreadMessage,
} from "../mutation-proposal";
import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";

function mutateMessage(
    id: string,
    operations: Array<Record<string, unknown>>,
): TProposalThreadMessage {
    return {
        id,
        role: "assistant",
        parts: [
            {
                type: "tool-mutateArtifact",
                output: { operations },
            },
        ],
    };
}

describe("mutation-proposal helpers", () => {
    it("builds recipe lines for catalog ops", () => {
        const recipe = buildMutationProposalRecipe([
            { op: "set_title", title: "Sprint" },
            { op: "add_week" },
        ]);
        expect(recipe.lines[0]).toContain("Sprint");
        expect(recipe.lines[1]).toContain("Add week");
    });

    it("lands empty-artifact mutates immediately", () => {
        const applied = new Set<string>();
        const marked: string[] = [];
        let committed: TChatArtifactDocument | null = null;
        const messages = [
            mutateMessage("a1", [{ op: "add_week" }, { op: "set_title", title: "Plan" }]),
        ];
        const ok = tryLandEmptyArtifactMutations(
            messages,
            "ready",
            { ...EMPTY_CHAT_ARTIFACT_DOCUMENT },
            applied,
            (keys) => {
                keys.forEach((key) => applied.add(key));
                marked.push(...keys);
            },
            (next) => {
                committed = next;
            },
        );
        expect(ok).toBe(true);
        expect(committed).not.toBeNull();
        expect(committed!.title).toBe("Plan");
        expect(committed!.weeks).toHaveLength(1);
        expect(applied.has("a1-0")).toBe(true);
        expect(marked).toContain("a1-0");
    });

    it("collects a proposal only when the artifact already has weeks", () => {
        const applied = new Set<string>();
        const document: TChatArtifactDocument = {
            title: "Plan",
            weeks: [{ days: [{ id: "d1", title: "A", items: [] }] }],
        };
        const messages = [
            mutateMessage("a1", [
                { op: "rename_day", weekIndex: 0, dayId: "d1", title: "B" },
            ]),
        ];
        const proposal = collectMutationProposal(messages, "ready", document, applied);
        expect(proposal?.operations).toHaveLength(1);

        const emptyProposal = collectMutationProposal(
            messages,
            "ready",
            { ...EMPTY_CHAT_ARTIFACT_DOCUMENT },
            applied,
        );
        expect(emptyProposal).toBeNull();
    });

    it("accept applies and records proposal mark keys", () => {
        const applied = new Set<string>();
        const document: TChatArtifactDocument = {
            title: "Plan",
            weeks: [{ days: [{ id: "d1", title: "A", items: [] }] }],
        };
        const proposal = {
            keys: ["a1-0"],
            messageIds: ["a1"],
            operations: [
                { op: "rename_day" as const, weekIndex: 0, dayId: "d1", title: "B" },
            ],
        };
        let committed: TChatArtifactDocument | null = null;
        let markKeys: number[] | undefined;
        const ok = acceptMutationProposal(
            document,
            proposal,
            (keys) => {
                keys.forEach((key) => applied.add(key));
            },
            (next, options) => {
                committed = next;
                markKeys = options?.proposalMarkKeys;
            },
        );
        expect(ok).toBe(true);
        expect(committed).not.toBeNull();
        expect(committed!.weeks[0]?.days[0]?.title).toBe("B");
        expect(markKeys?.length).toBeGreaterThan(0);
        expect(applied.has("a1-0")).toBe(true);
    });
});
