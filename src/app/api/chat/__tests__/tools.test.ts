/**
 * Agent manager tool registry (ADR 0001 / 03).
 *
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTools } from "@/app/api/chat/tools/tools";
import { ALWAYS_AVAILABLE_CHAT_TOOLS } from "@/app/api/chat/always-available-tools";

function reader(data: unknown[]): SupabaseClient {
    const mock: unknown = {
        from: () => ({
            select: () => ({
                order: () => ({
                    overrideTypes: async () => ({ data, error: null }),
                }),
            }),
        }),
    };
    return mock as SupabaseClient;
}

describe("chat tools", () => {
    it("registers readAgents and returns no agents when there are no calls", async () => {
        const tools = getTools(reader([]));
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
        expect(result).toEqual([]);
    });

    it("keeps readAgents available", () => {
        expect([...ALWAYS_AVAILABLE_CHAT_TOOLS]).toEqual(["readAgents"]);
    });
});
