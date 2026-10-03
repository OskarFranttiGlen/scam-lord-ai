/**
 * Agent manager tool registry (ADR 0002 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { getTools } from "@/app/api/chat/tools/tools";
import { ALWAYS_AVAILABLE_CHAT_TOOLS } from "@/app/api/chat/always-available-tools";
import { DEFAULT_AGENTS } from "@/lib/agent-floor/agents";

describe("chat tools", () => {
    it("registers readAgents and returns the default agents", async () => {
        const tools = getTools();
        expect(Object.keys(tools)).toEqual(["readAgents"]);
        const execute = tools.readAgents.execute;
        if (!execute) {
            throw new Error("readAgents has no execute");
        }
        const result = await execute({}, {
            toolCallId: "call-1",
            messages: [],
            context: {},
        });
        expect(result).toEqual(DEFAULT_AGENTS);
    });

    it("keeps readAgents available", () => {
        expect([...ALWAYS_AVAILABLE_CHAT_TOOLS]).toEqual(["readAgents"]);
    });
});
