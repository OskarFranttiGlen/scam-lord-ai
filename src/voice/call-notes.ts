/**
 * @module voice/call-notes
 *
 * Follow-up notes across calls. After each conversation a model reads the transcript and writes
 * a short summary plus the payment dates the tenant promised (accepted plan dates are added in
 * code); the notes go on `calls.ai_notes`. The next call loads recent notes, and promised dates
 * that passed while the balance is still owed count as broken promises. Two or more put the
 * agent in missed-promises mode (full balance today, no new plan).
 *
 * Depends on: ai, zod, ./context, ./supabase-client
 * Used by: @/voice/worker, @/voice/instructions, @/voice/tools
 */

import { Output, gateway, generateText } from "ai";
import { z } from "zod";

import type { CallState, TAcceptedPlan, TFollowUp } from "./context";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "./supabase-client";

/** Broken promises at which the agent stops offering new plans. */
export const MISSED_PROMISES_THRESHOLD = 2;

const NOTES_MODEL = process.env.SCAMLORD_NOTES_MODEL?.trim() || "openai/gpt-4.1-mini";
const RECENT_CALLS = 5;

export type TCallNotes = {
    summary: string;
    promises: Array<{ date: string; amount: number | null; source: "plan" | "verbal" }>;
    flags: string[];
};

const generatedNotesSchema = z.object({
    summary: z.string().describe("One or two plain sentences: what happened and where things were left."),
    promises: z.array(z.object({
        date: z.string().describe("YYYY-MM-DD the tenant said they would pay by"),
        amount: z.number().nullable().describe("Dollars promised, or null if not stated"),
    })).describe("Every specific payment date the tenant committed to. Empty if none."),
    flags: z.array(z.string()).describe("Short snake_case notes for the next caller, e.g. disputes_late_fee."),
});

export type TGeneratedNotes = z.infer<typeof generatedNotesSchema>;

/** Turns a notes prompt into structured notes; swappable in tests. */
export type TGenerateNotes = (prompt: string) => Promise<TGeneratedNotes>;

const callNotesSchema = z.object({
    summary: z.string(),
    promises: z.array(z.object({
        date: z.string(),
        amount: z.number().nullable(),
        source: z.enum(["plan", "verbal"]),
    })),
    flags: z.array(z.string()),
});

const generateNotes: TGenerateNotes = async (prompt) => {
    const result = await generateText({
        model: gateway(NOTES_MODEL),
        prompt,
        output: Output.object({ schema: generatedNotesSchema }),
        maxOutputTokens: 400,
        temperature: 0,
    });
    return generatedNotesSchema.parse(result.output);
};

/**
 * Notes for one conversation, or `null` when there is no transcript.
 *
 * @param input.transcript - `Agent: …` / `Tenant: …` lines
 * @param input.acceptedPlan - Plan accepted on the call; its dates are promises
 * @param input.today - Call date (YYYY-MM-DD), so relative dates resolve
 * @param input.generate - Model call; defaults to the gateway model
 */
export async function writeCallNotes(input: {
    transcript: string[];
    acceptedPlan?: TAcceptedPlan;
    today: string;
    generate?: TGenerateNotes;
}): Promise<TCallNotes | null> {
    if (!input.transcript.length) {
        return null;
    }
    const prompt = [
        `You write notes on a rent collection call for whoever calls this tenant next. Today is ${input.today}.`,
        "Resolve relative dates (\"Friday\", \"the ninth\") to YYYY-MM-DD after today. Only record a promise when "
            + "the tenant committed to a date, not when they said maybe or someday.",
        "",
        "Transcript:",
        ...input.transcript,
    ].join("\n");
    const generated = await (input.generate ?? generateNotes)(prompt);
    const planPromises = (input.acceptedPlan?.installments ?? []).map(row => ({
        date: row.date,
        amount: row.amount,
        source: "plan" as const,
    }));
    const verbal = generated.promises
        .filter(row => !planPromises.some(plan => plan.date === row.date))
        .map(row => ({ ...row, source: "verbal" as const }));
    return {
        summary: generated.summary.trim(),
        promises: [...planPromises, ...verbal].sort((a, b) => a.date.localeCompare(b.date)),
        flags: generated.flags,
    };
}

/**
 * Promised dates before today, once each, while the balance is still owed.
 *
 * @param notesList - Notes from earlier calls
 * @param options.today - YYYY-MM-DD
 * @param options.stillOwing - The tenant still has an open balance
 */
export function findBrokenPromises(
    notesList: TCallNotes[],
    { today, stillOwing }: { today: string; stillOwing: boolean },
): TFollowUp["brokenPromises"] {
    if (!stillOwing) {
        return [];
    }
    const byDate = new Map<string, number | null>();
    for (const notes of notesList) {
        for (const promise of notes.promises) {
            if (promise.date < today && !byDate.has(promise.date)) {
                byDate.set(promise.date, promise.amount);
            }
        }
    }
    return [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount }));
}

/**
 * Notes from the tenancy's recent conversations and the promises they broke. Never throws.
 *
 * @param client - Service-role Supabase client
 * @param tenancyId - Tenancy row id
 * @param options.today - YYYY-MM-DD
 * @param options.stillOwing - The tenant still has an open balance
 */
export async function loadFollowUp(
    client: TVoiceSupabaseClient,
    tenancyId: string,
    options: { today: string; stillOwing: boolean },
): Promise<TFollowUp | undefined> {
    try {
        const { data, error } = await client
            .from("calls")
            .select("created_at, ai_notes")
            .eq("tenancy_id", tenancyId)
            .not("ai_notes", "is", null)
            .order("created_at", { ascending: false })
            .limit(RECENT_CALLS);
        if (error) {
            return undefined;
        }
        const rows = (data ?? []).flatMap((row: { created_at: string; ai_notes: unknown }) => {
            const parsed = callNotesSchema.safeParse(row.ai_notes);
            return parsed.success ? [{ createdAt: row.created_at, notes: parsed.data }] : [];
        });
        if (!rows.length) {
            return undefined;
        }
        return {
            notes: rows.map(row => `${row.createdAt.slice(0, 10)}: ${row.notes.summary}`),
            brokenPromises: findBrokenPromises(rows.map(row => row.notes), options),
        };
    } catch {
        return undefined;
    }
}

/**
 * Writes notes for a finished conversation onto its `calls` row. Best effort; never throws.
 *
 * @param input.roomName - `calls.livekit_room_name` of the saved conversation
 * @param input.state - Final call state
 * @param input.client - Supabase client; `undefined` uses the env service-role client
 * @param input.generate - Model call override (tests)
 * @param input.today - Override for the call date (tests)
 */
export async function recordCallNotes(input: {
    roomName: string;
    state: CallState;
    client?: TVoiceSupabaseClient | null;
    generate?: TGenerateNotes;
    today?: string;
    log?: Pick<Console, "warn">;
}): Promise<void> {
    const log = input.log ?? console;
    try {
        const client = input.client === undefined ? getVoiceSupabaseClient() : input.client;
        if (!client) {
            return;
        }
        const notes = await writeCallNotes({
            transcript: input.state.transcriptLines,
            acceptedPlan: input.state.acceptedPlan,
            today: input.today ?? new Date().toISOString().slice(0, 10),
            generate: input.generate,
        });
        if (!notes) {
            return;
        }
        const { error } = await client.from("calls").update({ ai_notes: notes }).eq("livekit_room_name", input.roomName);
        if (error) {
            log.warn(`[voice/call-notes] notes not saved for ${input.roomName}: ${error.message}`);
        }
    } catch (error) {
        log.warn(`[voice/call-notes] notes failed for ${input.roomName}: ${String(error)}`);
    }
}
