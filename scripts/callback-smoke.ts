/**
 * @module scripts/callback-smoke
 *
 * End-to-end smoke test for inbound callbacks without Twilio. Each pass creates a fresh
 * `callback-…` room and joins as a fake caller whose token sets `sip.phoneNumber`, then speaks
 * ElevenLabs TTS lines and reads the agent's transcription. Passes:
 * 1. Known caller (a seeded tenancy whose last call was not handed off): greeting names the
 *    tenant and discloses the AI; the reply answers the plan request; a `calls` row with
 *    channel `callback` is written.
 * 2. Known caller with an earlier handoff: greeting promises a person, no amounts; the row stays
 *    `waiting_on_person`. If no tenancy is handed off yet, pass 1 adds a hardship line (Jev flags
 *    it) and pass 2 calls back from the same number.
 * 3. Unknown number: no balance or account details spoken, the agent hangs up after taking a
 *    name, and no `calls` row is written.
 *
 * A token cannot make a participant SIP-kind, so the worker must run with
 * `VOICE_DEV_FAKE_SIP_CALLERS=1` for the phone attribute to count.
 *
 * Run:
 * ```bash
 * set -a && source .env && set +a && VOICE_DEV_FAKE_SIP_CALLERS=1 npx tsx src/voice/worker.ts dev
 * set -a && source .env && set +a && npx tsx scripts/callback-smoke.ts
 * ```
 *
 * Depends on: livekit-server-sdk, @livekit/rtc-node, ElevenLabs REST TTS, src/voice/inbound-caller,
 * src/voice/supabase-client
 * Used by: manual verification of src/voice/worker.ts callbacks
 */

import {
    AudioFrame,
    AudioSource,
    AudioStream,
    LocalAudioTrack,
    type Participant,
    type RemoteTrack,
    Room,
    RoomEvent,
    TrackKind,
    TrackPublishOptions,
    TrackSource,
    dispose,
} from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

import { CALLBACK_ROOM_PREFIX, SIP_PHONE_NUMBER_ATTRIBUTE } from "../src/voice/inbound-caller";
import { getVoiceSupabaseClient, type TVoiceSupabaseClient } from "../src/voice/supabase-client";

const SAMPLE_RATE = 16_000;
const FRAME_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;
const SOURCE_QUEUE_MS = 50;
const VOICED_RMS = 400;
const STEP_TIMEOUT_MS = 45_000;
const TRANSCRIPT_SETTLE_MS = 1500;
const HANGUP_TIMEOUT_MS = 15_000;
const PERSIST_TIMEOUT_MS = 30_000;
const CALLER_IDENTITY = "caller-smoke";
const UNKNOWN_NUMBER = "+15555559999";
/** Premade "Sarah"; caller voice distinct from the agent's default. */
const CALLER_VOICE_ID = process.env.SMOKE_TENANT_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

const PLAN_LINE = "Hi, I got a text about my rent, can I pay half next Friday?";
const NAME_LINE = "It's Pat Doe, I'm calling about Maple Court.";
/** Spoken on the known pass when no tenancy is handed off yet, so the next pass can test carry-over. */
const HARDSHIP_LINE = "Honestly I lost my job last week, so money is really tight right now.";
const ACCOUNT_DETAILS = /dollar|\$|\d|balance|\bowe|invoice/i;

type TPassKind = "known" | "known_handoff" | "unknown";

type TPass = {
    kind: TPassKind;
    phoneNumber: string;
    tenantFirstName?: string;
    lines: string[];
};

type TPassResult = {
    pass: TPass;
    roomName: string;
    greeting: string;
    replies: string[];
    hungUp: boolean;
    callRow: { channel: string; status: string; handoff_reason: string | null } | null;
    checks: Array<{ label: string; ok: boolean }>;
};

/**
 * Reads a required env var or exits.
 *
 * @param key - Environment variable name
 */
function requireEnv(key: string): string {
    const value = process.env[key]?.trim();
    if (!value) {
        console.error(`[callback-smoke] Missing env ${key}`);
        process.exit(1);
    }
    return value;
}

/**
 * Sleeps for a number of milliseconds.
 *
 * @param ms - Delay in milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a predicate until true or timeout.
 *
 * @param label - What we are waiting for (error message)
 * @param predicate - Condition to wait on
 * @param timeoutMs - Max wait
 */
async function waitFor(label: string, predicate: () => boolean, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error(`[callback-smoke] timed out waiting for ${label}`);
        }
        await sleep(20);
    }
}

/**
 * Synthesizes 16 kHz mono PCM for a caller line via ElevenLabs REST.
 *
 * @param text - Line to speak
 * @param apiKey - ElevenLabs API key
 */
async function synthesizeCallerPcm(text: string, apiKey: string): Promise<Int16Array> {
    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${CALLER_VOICE_ID}?output_format=pcm_16000`,
        {
            method: "POST",
            headers: { "xi-api-key": apiKey, "content-type": "application/json" },
            body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
        },
    );
    if (!response.ok) {
        throw new Error(`[callback-smoke] ElevenLabs TTS ${response.status}: ${await response.text()}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const samples = new Int16Array(Math.floor(bytes.length / 2));
    for (let i = 0; i < samples.length; i++) {
        samples[i] = bytes.readInt16LE(i * 2);
    }
    return samples;
}

/**
 * Root-mean-square energy of an int16 frame.
 *
 * @param data - PCM samples
 */
function rms(data: Int16Array): number {
    let sum = 0;
    for (const sample of data) {
        sum += sample * sample;
    }
    return Math.sqrt(sum / Math.max(1, data.length));
}

/**
 * Continuous mic: plays queued utterances, otherwise silence, at real-time pace.
 */
class CallerMic {
    readonly source = new AudioSource(SAMPLE_RATE, 1, SOURCE_QUEUE_MS);
    #pending: { samples: Int16Array; resolve: (endedAt: number) => void } | undefined;
    #running = true;

    /** Starts the capture loop; resolves when {@link stop} is called. */
    async run(): Promise<void> {
        const silence = new Int16Array(SAMPLES_PER_FRAME);
        while (this.#running) {
            const current = this.#pending;
            if (!current) {
                await this.source.captureFrame(new AudioFrame(silence, SAMPLE_RATE, 1, SAMPLES_PER_FRAME));
                continue;
            }
            for (let offset = 0; offset < current.samples.length; offset += SAMPLES_PER_FRAME) {
                const chunk = new Int16Array(SAMPLES_PER_FRAME);
                chunk.set(current.samples.subarray(offset, offset + SAMPLES_PER_FRAME));
                await this.source.captureFrame(new AudioFrame(chunk, SAMPLE_RATE, 1, SAMPLES_PER_FRAME));
            }
            this.#pending = undefined;
            current.resolve(Date.now() + SOURCE_QUEUE_MS);
        }
    }

    /**
     * Queues an utterance; resolves with the estimated wall time its last sample is sent.
     *
     * @param samples - 16 kHz mono PCM
     */
    speak(samples: Int16Array): Promise<number> {
        return new Promise((resolve) => {
            this.#pending = { samples, resolve };
        });
    }

    stop(): void {
        this.#running = false;
    }
}

/**
 * Picks the seeded tenancies for the known passes: one whose latest call is not a handoff, and
 * one whose latest call is (when present).
 *
 * @param db - Service-role Supabase client
 */
async function pickKnownCallers(db: TVoiceSupabaseClient): Promise<TPass[]> {
    const tenancies = await db.from("tenancies").select("id, name, phone").order("name");
    if (tenancies.error) {
        throw new Error(`tenancies lookup failed: ${tenancies.error.message}`);
    }
    let known: TPass | undefined;
    let handedOff: TPass | undefined;
    for (const tenancy of tenancies.data) {
        const latest = await db
            .from("calls")
            .select("status, handoff_reason")
            .eq("tenancy_id", tenancy.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        const isHandoff = Boolean(latest.data && (latest.data.handoff_reason || latest.data.status === "waiting_on_person"));
        const pass = {
            phoneNumber: tenancy.phone,
            tenantFirstName: tenancy.name.split(/\s+/)[0],
            lines: [PLAN_LINE],
        };
        if (isHandoff) {
            handedOff ??= { ...pass, kind: "known_handoff" };
        } else {
            known ??= { ...pass, kind: "known" };
        }
    }
    return [known, handedOff].filter((pass): pass is TPass => pass !== undefined);
}

/**
 * Polls for the `calls` row the worker writes on shutdown.
 *
 * @param db - Service-role Supabase client
 * @param roomName - Room the call ran in
 * @param timeoutMs - Max wait
 */
async function waitForCallRow(db: TVoiceSupabaseClient, roomName: string, timeoutMs: number): Promise<TPassResult["callRow"]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data } = await db
            .from("calls")
            .select("channel, status, handoff_reason")
            .eq("livekit_room_name", roomName)
            .maybeSingle();
        if (data) {
            return data;
        }
        await sleep(1000);
    }
    return null;
}

/**
 * Runs one simulated callback and evaluates its checks.
 *
 * @param pass - Caller number, expected kind, and lines to speak
 * @param env - LiveKit + ElevenLabs credentials and the Supabase client
 */
async function runPass(
    pass: TPass,
    env: { url: string; apiKey: string; apiSecret: string; elevenKey: string; db: TVoiceSupabaseClient },
): Promise<TPassResult> {
    const audio = await Promise.all(pass.lines.map((line) => synthesizeCallerPcm(line, env.elevenKey)));
    const roomName = `${CALLBACK_ROOM_PREFIX}smoke-${pass.kind}-${Date.now()}`;
    const rooms = new RoomServiceClient(env.url.replace(/^ws/, "http"), env.apiKey, env.apiSecret);
    await rooms.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 5 });

    const token = new AccessToken(env.apiKey, env.apiSecret, {
        identity: CALLER_IDENTITY,
        name: "Callback (smoke)",
        attributes: { [SIP_PHONE_NUMBER_ATTRIBUTE]: pass.phoneNumber },
    });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const room = new Room();
    let agentState = "initializing";
    let speakingTransitions = 0;
    let lastSpeakingAt = 0;
    let lastVoicedAt = 0;
    let disconnected = false;
    const voicedEvents: number[] = [];
    const agentTranscripts: string[] = [];

    const onAgentAttributes = (attributes: Record<string, string>): void => {
        const next = attributes["lk.agent.state"];
        if (!next || next === agentState) {
            return;
        }
        if (next === "speaking") {
            speakingTransitions += 1;
            lastSpeakingAt = Date.now();
        }
        agentState = next;
    };

    room.on(RoomEvent.Disconnected, () => {
        disconnected = true;
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>, participant: Participant) => {
        if (participant.identity !== CALLER_IDENTITY) {
            onAgentAttributes(changed);
        }
    });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== TrackKind.KIND_AUDIO) {
            return;
        }
        void (async () => {
            const reader = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 }).getReader();
            while (true) {
                const { done, value: frame } = await reader.read();
                if (done) {
                    break;
                }
                if (rms(frame.data) > VOICED_RMS) {
                    const now = Date.now();
                    if (now - lastVoicedAt > 300) {
                        voicedEvents.push(now);
                    }
                    lastVoicedAt = now;
                }
            }
        })();
    });
    room.registerTextStreamHandler("lk.transcription", (reader, info) => {
        if (info.identity === CALLER_IDENTITY) {
            return;
        }
        void reader.readAll().then((text) => {
            if (text.trim()) {
                agentTranscripts.push(text.trim());
                console.log(`[callback-smoke]   agent said: ${text.trim()}`);
            }
        });
    });

    console.log(`\n[callback-smoke] pass ${pass.kind}: calling from ${pass.phoneNumber} into ${roomName}`);
    await room.connect(env.url, await token.toJwt(), { autoSubscribe: true, dynacast: false });
    const mic = new CallerMic();
    const micTrack = LocalAudioTrack.createAudioTrack("caller-mic", mic.source);
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant?.publishTrack(micTrack, publishOptions);
    const micLoop = mic.run();

    let greeting = "";
    const replies: string[] = [];
    try {
        await waitFor("agent participant", () => room.remoteParticipants.size > 0);
        for (const participant of room.remoteParticipants.values()) {
            onAgentAttributes(participant.attributes);
        }
        await waitFor("greeting audio", () => voicedEvents.length > 0);
        await waitFor("greeting to finish", () => agentState === "listening" && Date.now() - lastVoicedAt > 800);
        await sleep(TRANSCRIPT_SETTLE_MS);
        greeting = agentTranscripts.join(" ");

        for (const [index, line] of pass.lines.entries()) {
            const transitionsBefore = speakingTransitions;
            const transcriptsBefore = agentTranscripts.length;
            console.log(`[callback-smoke] caller: ${line}`);
            const endedAt = await mic.speak(audio[index]);
            await waitFor(
                "agent reply",
                () => disconnected || (speakingTransitions > transitionsBefore && lastSpeakingAt > endedAt),
            );
            await waitFor(
                "reply to finish",
                () => disconnected || (agentState === "listening" && Date.now() - lastVoicedAt > 800),
            );
            await sleep(TRANSCRIPT_SETTLE_MS);
            replies.push(agentTranscripts.slice(transcriptsBefore).join(" "));
        }
        if (pass.kind === "unknown") {
            await waitFor("agent to hang up", () => disconnected, HANGUP_TIMEOUT_MS).catch(() => undefined);
        }
    } finally {
        mic.stop();
        await micLoop.catch(() => undefined);
        if (!disconnected) {
            await room.disconnect();
        }
        await rooms.deleteRoom(roomName).catch(() => undefined);
    }

    const callRow = await waitForCallRow(env.db, roomName, pass.kind === "unknown" ? 8000 : PERSIST_TIMEOUT_MS);
    const spoken = [greeting, ...replies].join(" ");
    const checks: TPassResult["checks"] = [{ label: "greeting discloses AI", ok: /\bAI\b/.test(greeting) }];
    if (pass.kind === "unknown") {
        checks.push(
            { label: "no account details spoken", ok: !ACCOUNT_DETAILS.test(spoken) },
            { label: "agent hung up after taking a name", ok: disconnected },
            { label: "no calls row written", ok: callRow === null },
        );
    } else {
        checks.push(
            { label: "greeting names the tenant", ok: greeting.includes(pass.tenantFirstName ?? "?") },
            { label: "agent replied", ok: replies.every(Boolean) },
            { label: "calls row with channel callback", ok: callRow?.channel === "callback" },
        );
    }
    if (pass.kind === "known_handoff") {
        checks.push(
            { label: "no amounts after a handoff", ok: !/dollar|\$|\d/i.test(spoken) },
            { label: "row still waiting on a person", ok: callRow?.status === "waiting_on_person" },
        );
    }
    return { pass, roomName, greeting, replies, hungUp: disconnected, callRow, checks };
}

/**
 * Runs every pass and prints a report.
 */
async function main(): Promise<void> {
    const db = getVoiceSupabaseClient();
    if (!db) {
        console.error("[callback-smoke] Supabase service-role env is missing");
        process.exit(1);
    }
    const env = {
        url: requireEnv("LIVEKIT_URL"),
        apiKey: requireEnv("LIVEKIT_API_KEY"),
        apiSecret: requireEnv("LIVEKIT_API_SECRET"),
        elevenKey: requireEnv("ELEVEN_API_KEY"),
        db,
    };

    const passes = await pickKnownCallers(env.db);
    const known = passes.find((pass) => pass.kind === "known");
    if (known && !passes.some((pass) => pass.kind === "known_handoff")) {
        known.lines = [PLAN_LINE, HARDSHIP_LINE];
        passes.push({ ...known, kind: "known_handoff", lines: [PLAN_LINE] });
    }
    passes.push({ kind: "unknown", phoneNumber: UNKNOWN_NUMBER, lines: [PLAN_LINE, NAME_LINE] });
    const results: TPassResult[] = [];
    for (const pass of passes) {
        results.push(await runPass(pass, env));
    }

    console.log("\n===== callback smoke report =====");
    for (const result of results) {
        console.log(`\n${result.pass.kind} (${result.pass.phoneNumber}) room ${result.roomName}`);
        console.log(`  greeting: ${result.greeting || "(none)"}`);
        for (const [index, reply] of result.replies.entries()) {
            console.log(`  caller:   ${result.pass.lines[index]}`);
            console.log(`  agent:    ${reply || "(none)"}`);
        }
        console.log(`  calls row: ${result.callRow ? JSON.stringify(result.callRow) : "none"}`);
        for (const check of result.checks) {
            console.log(`  [${check.ok ? "ok" : "FAIL"}] ${check.label}`);
        }
    }
    const passed = results.every((result) => result.checks.every((check) => check.ok));
    console.log(`\nverdict: ${passed ? "PASS" : "FAIL"}`);
    await dispose();
    process.exit(passed ? 0 : 1);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
