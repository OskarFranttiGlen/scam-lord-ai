/**
 * Keep-set registry tests for chat tools (ADR 0034 / C2).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";

import { getTools } from "@/app/api/chat/tools/tools";
import { ALWAYS_AVAILABLE_CHAT_TOOLS } from "@/app/api/chat/always-available-tools";
import { mutateArtifactInputSchema } from "@/components/artifact-builder/mutations/agentSchema";
import {
    formatReadArtifactForModel,
    readArtifactSnapshot,
} from "@/app/api/chat/tools/read-artifact";
import { runMutateArtifactTool } from "@/app/api/chat/tools/mutate-artifact-execute";
import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";

const KILLED_TOOLS = [
    "buildProgram",
    "getExerciseList",
    "openHevyExportGate",
    "getWorkoutHistory",
    "getBodyMeasurements",
    "rateProgram",
    "importHevyShareFolder",
    "fetchHevyShareFolder",
    "updateConstraintProfile",
    "updateTrainingProfile",
    "mutateProgram",
    "readProgram",
] as const;

const KEEP_SET = [
    "readArtifact",
    "mutateArtifact",
    "loadSkill",
    "readFile",
    "bash",
    "getMoreInfoQuestions",
] as const;

const SAMPLE_DOCUMENT: TChatArtifactDocument = {
    title: "Plan",
    weeks: [
        {
            days: [
                {
                    id: "day-1",
                    title: "Day A",
                    items: [{ id: "item-1", title: "Write intro" }],
                },
            ],
        },
    ],
};

describe("chat tools.ts keep-set", () => {
    it("registers exactly the C2 keep-set and no killed domain tools", () => {
        const tools = getTools();
        for (const name of KEEP_SET) {
            expect(tools).toHaveProperty(name);
        }
        for (const name of KILLED_TOOLS) {
            expect(tools).not.toHaveProperty(name);
        }
        expect(Object.keys(tools).sort()).toEqual([...KEEP_SET].sort());
    });

    it("ALWAYS_AVAILABLE_CHAT_TOOLS is sandbox trio + getMoreInfoQuestions", () => {
        expect([...ALWAYS_AVAILABLE_CHAT_TOOLS].sort()).toEqual(
            ["bash", "getMoreInfoQuestions", "loadSkill", "readFile"].sort(),
        );
        for (const name of KILLED_TOOLS) {
            expect(ALWAYS_AVAILABLE_CHAT_TOOLS).not.toContain(name);
        }
        expect(ALWAYS_AVAILABLE_CHAT_TOOLS).not.toContain("readArtifact");
        expect(ALWAYS_AVAILABLE_CHAT_TOOLS).not.toContain("mutateArtifact");
    });

    describe("mutateArtifactInputSchema", () => {
        it("accepts rename_day", () => {
            const parsed = mutateArtifactInputSchema.safeParse({
                operations: [
                    { op: "rename_day", weekIndex: 0, dayId: "day-1", title: "Pull" },
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

    describe("readArtifact / mutateArtifact execute bodies", () => {
        it("readArtifact snapshot returns the request-start document", () => {
            expect(readArtifactSnapshot(SAMPLE_DOCUMENT)).toEqual(SAMPLE_DOCUMENT);
        });

        it("mutateArtifact validates against the snapshot and returns operations", () => {
            const result = runMutateArtifactTool(
                SAMPLE_DOCUMENT,
                [
                    {
                        op: "rename_day",
                        weekIndex: 0,
                        dayId: "day-1",
                        title: "Day B",
                    },
                ],
                true,
            );
            expect(result).toEqual({
                operations: [
                    {
                        op: "rename_day",
                        weekIndex: 0,
                        dayId: "day-1",
                        title: "Day B",
                    },
                ],
            });
        });

        it("mutateArtifact requires same-turn read when the artifact has weeks", () => {
            const result = runMutateArtifactTool(
                SAMPLE_DOCUMENT,
                [
                    {
                        op: "rename_day",
                        weekIndex: 0,
                        dayId: "day-1",
                        title: "Day B",
                    },
                ],
                false,
            );
            expect(result).toMatchObject({ error: "readArtifact_required" });
        });

        it("mutateArtifact on an empty artifact does not require a prior read", () => {
            const result = runMutateArtifactTool(
                { ...EMPTY_CHAT_ARTIFACT_DOCUMENT },
                [{ op: "add_week" }],
                false,
            );
            expect(result).toEqual({ operations: [{ op: "add_week" }] });
        });
    });

    describe("read-artifact helpers", () => {
        it("formats targeting docs for a non-empty snapshot", () => {
            const snapshot = readArtifactSnapshot(SAMPLE_DOCUMENT);
            const text = formatReadArtifactForModel(snapshot);
            expect(text).toContain("weekIndex");
            expect(text).toContain("dayId");
            expect(text).toContain("Write intro");
        });

        it("describes an empty snapshot", () => {
            const text = formatReadArtifactForModel({ title: "", weeks: [] });
            expect(text).toContain("empty");
        });
    });
});
