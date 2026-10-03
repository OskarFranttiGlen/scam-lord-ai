/**
 * Neutral Agent instructions (ADR 0034 / C11).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";

import { instructions } from "@/app/api/chat/instructions/instructions";
import { getTools } from "@/app/api/chat/tools/tools";

const skillPath = path.join(
    process.cwd(),
    ".agents/skills/mutate-artifact/SKILL.md",
);

describe("chat instructions (ADR 0034 / C11)", () => {
    const prompt = instructions();

    it("identifies as Agent and teaches mutate-artifact, not Andy/fitness coach", () => {
        expect(prompt).toContain("You are Agent");
        expect(prompt).toContain("mutate-artifact");
        expect(prompt).toContain("Chat artifact");
        expect(prompt).not.toMatch(/\bAndy\b/);
        expect(prompt).not.toContain("Personal Trainer");
        expect(prompt).not.toContain("dashboard");
    });

    it("lists keep-set tools including Artifact CRUD and does not teach killed tools", () => {
        expect(prompt).toContain("loadSkill");
        expect(prompt).toContain("readFile");
        expect(prompt).toContain("bash");
        expect(prompt).toContain("readArtifact");
        expect(prompt).toContain("mutateArtifact");
        expect(prompt).toContain("getMoreInfoQuestions");

        expect(prompt).not.toMatch(/\bbuildProgram\b/);
        expect(prompt).not.toMatch(/\bgetExerciseList\b/);
        expect(prompt).not.toMatch(/\bopenHevyExportGate\b/);
        expect(prompt).not.toMatch(/\bgetWorkoutHistory\b/);
        expect(prompt).not.toMatch(/\bgetBodyMeasurements\b/);
        expect(prompt).not.toMatch(/\brateProgram\b/);
        expect(prompt).not.toMatch(/\bimportHevyShareFolder\b/);
        expect(prompt).not.toMatch(/\bfetchHevyShareFolder\b/);
        expect(prompt).not.toMatch(/\bupdateConstraintProfile\b/);
        expect(prompt).not.toMatch(/\bupdateTrainingProfile\b/);
        expect(prompt).not.toMatch(/\bmutateProgram\b/);
        expect(prompt).not.toMatch(/\breadProgram\b/);
        expect(prompt).not.toMatch(/Hevy export/i);
        expect(prompt).not.toMatch(/periodization/i);
        expect(prompt).not.toMatch(/Soft-fail/i);
        expect(prompt).not.toMatch(/does not yet register/i);
    });

    it("does not force the questionnaire before artifact work", () => {
        expect(prompt).toMatch(/Optional/i);
        expect(prompt).toContain("Never treat the Questionnaire gate as a mandatory first step");
        expect(prompt).not.toMatch(/open the questionnaire before/i);
        expect(prompt).not.toContain("Mandatory skill loading");
        expect(prompt).not.toContain("call `getMoreInfoQuestions` (plus");
    });

    it("teaches Mutation proposal voice and empty-grid New arrival", () => {
        expect(prompt).toContain("Mutation proposal");
        expect(prompt).toContain("I've updated");
        expect(prompt).toMatch(/empty grid/i);
        expect(prompt).toContain("loadSkill");
        expect(prompt).toContain("mutate-artifact");
    });
});

describe("chat tools keep-set matches instructions (C2)", () => {
    it("registers exactly the Artifact CRUD keep-set", () => {
        const tools = getTools();
        expect(Object.keys(tools).sort()).toEqual(
            [
                "bash",
                "getMoreInfoQuestions",
                "loadSkill",
                "mutateArtifact",
                "readArtifact",
                "readFile",
            ].sort(),
        );
    });
});

describe("mutate-artifact skill (ADR 0034 / C11)", () => {
    it("exists with CRUD allowlist, op list, and read-before-mutate", () => {
        expect(existsSync(skillPath)).toBe(true);
        const skill = readFileSync(skillPath, "utf-8");
        expect(skill).toMatch(/^---[\s\S]*?name:\s*mutate-artifact/m);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowedTools:/);
        expect(skill).toContain("readArtifact");
        expect(skill).toContain("mutateArtifact");
        expect(skill).toContain("readFile");
        expect(skill).toContain("bash");
        expect(skill).toContain("set_title");
        expect(skill).toContain("upsert_item");
        expect(skill).toContain("Mutation proposal");
        expect(skill).toMatch(/Questionnaire/);
        expect(skill).not.toContain("dashboard");
        expect(skill).not.toMatch(/CRUD not registered/i);
        expect(skill).not.toMatch(/slice 7/i);
        expect(skill).not.toMatch(/Soft-fail/i);
        expect(skill).not.toMatch(/\bbuildProgram\b/);
    });
});
