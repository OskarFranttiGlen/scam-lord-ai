/**
 * Agent manager instructions (ADR 0002 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { instructions } from "@/app/api/chat/instructions/instructions";
import { getTools } from "@/app/api/chat/tools/tools";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("chat instructions", () => {
    const prompt = instructions();

    it("identifies as the Agent manager and tells it to read agents", () => {
        expect(prompt).toContain("You are the Agent manager");
        expect(prompt).toContain("readAgents");
        expect(prompt).toContain("plain language");
        expect(prompt).toMatch(/cannot start, stop, or change an agent/);
        expect(prompt).toMatch(/read-only/);
    });

    it("omits artifact editing, bash, and Shipworthy", () => {
        expect(prompt).not.toContain("mutateArtifact");
        expect(prompt).not.toContain("bash");
        expect(prompt).not.toContain("Shipworthy");
    });
});

describe("chat tools match the Agent manager", () => {
    it("registers readAgents", () => {
        const mock: unknown = { from() { throw new Error("not used"); } };
        expect(Object.keys(getTools(mock as SupabaseClient))).toEqual(["readAgents"]);
    });
});
