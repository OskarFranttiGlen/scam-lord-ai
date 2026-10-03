import { describe, expect, it, vi } from "vitest";

import {
    findBrokenPromises,
    loadFollowUp,
    recordCallNotes,
    writeCallNotes,
    type TCallNotes,
} from "../call-notes";
import { createInitialCallState } from "../context";
import { getDemoCallContext } from "../demo-context";
import { buildNegotiationInstructions } from "../instructions";
import type { TVoiceSupabaseClient } from "../supabase-client";
import { getCollectionTools } from "../tools";

const TOOL_OPTIONS = { toolCallId: "call_1", messages: [], context: {} };

function asDb(mock: unknown): TVoiceSupabaseClient {
    return mock as TVoiceSupabaseClient;
}

const notes = (promises: TCallNotes["promises"], summary = "Said they would pay."): TCallNotes => ({
    summary,
    promises,
    flags: [],
});

describe("writeCallNotes", () => {
    it("keeps the model's summary and verbal promises and adds the accepted plan's dates", async () => {
        const generate = vi.fn().mockResolvedValue({
            summary: "Agreed to a split; mentioned payday on the ninth.",
            promises: [{ date: "2026-10-09", amount: 500 }],
            flags: ["mentioned_payday"],
        });

        const result = await writeCallNotes({
            transcript: ["Agent: Can you take care of it today?", "Tenant: I get paid on the ninth."],
            acceptedPlan: { installments: [{ date: "2026-10-03", amount: 920 }, { date: "2026-10-12", amount: 920 }] },
            today: "2026-10-03",
            generate,
        });

        expect(result).toEqual({
            summary: "Agreed to a split; mentioned payday on the ninth.",
            promises: [
                { date: "2026-10-03", amount: 920, source: "plan" },
                { date: "2026-10-09", amount: 500, source: "verbal" },
                { date: "2026-10-12", amount: 920, source: "plan" },
            ],
            flags: ["mentioned_payday"],
        });
        expect(String(generate.mock.calls[0][0])).toContain("Tenant: I get paid on the ninth.");
    });

    it("returns null for an empty transcript without calling the model", async () => {
        const generate = vi.fn();

        expect(await writeCallNotes({ transcript: [], today: "2026-10-03", generate })).toBeNull();
        expect(generate).not.toHaveBeenCalled();
    });
});

describe("findBrokenPromises", () => {
    it("counts each past promised date once while the balance is still owed", () => {
        const broken = findBrokenPromises([
            notes([{ date: "2026-09-20", amount: 1840, source: "verbal" }]),
            notes([{ date: "2026-09-20", amount: 1840, source: "verbal" }, { date: "2026-09-27", amount: null, source: "verbal" }]),
            notes([{ date: "2026-10-09", amount: 1840, source: "plan" }]),
        ], { today: "2026-10-03", stillOwing: true });

        expect(broken).toEqual([
            { date: "2026-09-20", amount: 1840 },
            { date: "2026-09-27", amount: null },
        ]);
    });

    it("finds none when nothing is owed", () => {
        expect(findBrokenPromises(
            [notes([{ date: "2026-09-20", amount: 1840, source: "verbal" }])],
            { today: "2026-10-03", stillOwing: false },
        )).toEqual([]);
    });
});

describe("loadFollowUp", () => {
    it("reads notes from the tenancy's recent calls, newest first", async () => {
        const limit = vi.fn().mockResolvedValue({
            data: [
                { created_at: "2026-09-28T10:00:00Z", ai_notes: notes([{ date: "2026-09-30", amount: 1840, source: "verbal" }], "Promised Wednesday.") },
                { created_at: "2026-09-21T10:00:00Z", ai_notes: notes([{ date: "2026-09-25", amount: 1840, source: "verbal" }], "Promised Friday.") },
                { created_at: "2026-09-14T10:00:00Z", ai_notes: null },
            ],
            error: null,
        });
        const eq = vi.fn(() => ({ not: () => ({ order: () => ({ limit }) }) }));
        const db = asDb({ from: vi.fn(() => ({ select: () => ({ eq }) })) });

        const followUp = await loadFollowUp(db, "ten_1", { today: "2026-10-03", stillOwing: true });

        expect(eq).toHaveBeenCalledWith("tenancy_id", "ten_1");
        expect(followUp).toEqual({
            notes: ["2026-09-28: Promised Wednesday.", "2026-09-21: Promised Friday."],
            brokenPromises: [{ date: "2026-09-25", amount: 1840 }, { date: "2026-09-30", amount: 1840 }],
        });
    });
});

describe("recordCallNotes", () => {
    it("writes the notes onto the call row for the room", async () => {
        const eq = vi.fn().mockResolvedValue({ error: null });
        const update = vi.fn(() => ({ eq }));
        const db = asDb({ from: vi.fn(() => ({ update })) });
        const state = createInitialCallState();
        state.transcriptLines = ["Agent: Hi", "Tenant: I'll pay Friday."];
        const generate = vi.fn().mockResolvedValue({ summary: "Will pay Friday.", promises: [{ date: "2026-10-09", amount: null }], flags: [] });

        await recordCallNotes({ roomName: "collect-room", state, client: db, generate, today: "2026-10-03" });

        expect(update).toHaveBeenCalledWith({
            ai_notes: { summary: "Will pay Friday.", promises: [{ date: "2026-10-09", amount: null, source: "verbal" }], flags: [] },
        });
        expect(eq).toHaveBeenCalledWith("livekit_room_name", "collect-room");
    });
});

describe("missed promises on the next call", () => {
    const broken = [{ date: "2026-09-25", amount: 1840 }, { date: "2026-09-30", amount: 1840 }];
    const ctx = { ...getDemoCallContext(), followUp: { notes: ["2026-09-28: Promised Wednesday."], brokenPromises: broken } };

    it("tells the agent to name the missed dates once and ask for the full balance today", () => {
        const prompt = buildNegotiationInstructions(ctx, true, "voice");

        expect(prompt).toContain("2026-09-28: Promised Wednesday.");
        expect(prompt).toContain("The last two payment dates were missed.");
        expect(prompt).toMatch(/no new plan/i);
        expect(prompt).toMatch(/missed_promises/);
    });

    it("only accepts the full balance today, not a new split", async () => {
        const state = createInitialCallState();
        const tools = getCollectionTools(ctx, state, { channel: "voice" });
        const today = new Date().toISOString().slice(0, 10);

        const split = await tools.check_policy.execute?.(
            { installments: [{ date: today, amount: 1200 }, { date: "2026-10-12", amount: 1200 }] },
            TOOL_OPTIONS,
        );
        const full = await tools.check_policy.execute?.({ installments: [{ date: today, amount: 2400 }] }, TOOL_OPTIONS);

        expect(split).toMatchObject({ status: "plan_not_available" });
        expect(full).toMatchObject({ status: "accepted" });
    });

    it("keeps plans open with fewer than two missed dates", () => {
        const prompt = buildNegotiationInstructions(
            { ...ctx, followUp: { notes: [], brokenPromises: broken.slice(0, 1) } },
            true,
            "voice",
        );

        expect(prompt).not.toMatch(/payment dates were missed/);
    });
});
