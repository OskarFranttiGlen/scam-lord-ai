/**
 * @module scripts/voice-call-smoke
 *
 * End-to-end smoke test for the LiveKit voice worker. Creates a fresh room, joins as a fake
 * tenant, waits for the agent greeting, then speaks tenant lines (ElevenLabs PCM TTS) over a
 * continuous mic track. Reports greeting, replies per tenant line (via `lk.agent.state`), and
 * end-of-tenant-audio → first agent audio frame latency. The last line barges in mid-reply
 * to exercise interruptions.
 *
 * Run (worker must be running: `npx tsx src/voice/worker.ts dev`):
 * ```bash
 * set -a && source .env && set +a && npx tsx scripts/voice-call-smoke.ts
 * ```
 *
 * Depends on: livekit-server-sdk, @livekit/rtc-node, ElevenLabs REST TTS
 * Used by: manual / CI-style verification of src/voice/worker.ts
 */

import {
    AudioFrame,
    AudioSource,
    AudioStream,
    LocalAudioTrack,
    type Participant,
    type RemoteParticipant,
    type RemoteTrack,
    Room,
    RoomEvent,
    TrackKind,
    TrackPublishOptions,
    TrackSource,
    dispose,
} from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const SAMPLE_RATE = 16_000;
const FRAME_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;
const SOURCE_QUEUE_MS = 50;
const VOICED_RMS = 400;
const SETTLE_MS = 3500;
const STEP_TIMEOUT_MS = 45_000;
const BARGE_IN_DELAY_MS = 1500;
/** Premade "Sarah"; tenant voice distinct from the agent's default. */
const TENANT_VOICE_ID = process.env.SMOKE_TENANT_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";

type TTenantLine = {
    text: string;
    /** Speak while the agent is replying to the previous line (barge-in). */
    bargeIn?: boolean;
};

type TLineResult = {
    text: string;
    replies: number;
    latencyMs?: number;
    agentStoppedAfterBargeInMs?: number;
    agentText: string[];
};

const TENANT_LINES: TTenantLine[] = [
    { text: "Yeah this is Jordan. I can pay half next Friday." },
    { text: "I lost my job last week, so money is really tight right now." },
    { text: "Sorry, wait, hold on. Can you just text me the payment link?", bargeIn: true },
];

/**
 * Reads a required env var or exits.
 *
 * @param key - Environment variable name
 */
function requireEnv(key: string): string {
    const value = process.env[key]?.trim();
    if (!value) {
        console.error(`[smoke] Missing env ${key}`);
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
            throw new Error(`[smoke] timed out waiting for ${label}`);
        }
        await sleep(20);
    }
}

/**
 * Synthesizes 16 kHz mono PCM for a tenant line via ElevenLabs REST.
 *
 * @param text - Line to speak
 * @param apiKey - ElevenLabs API key
 */
async function synthesizeTenantPcm(text: string, apiKey: string): Promise<Int16Array> {
    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${TENANT_VOICE_ID}?output_format=pcm_16000`,
        {
            method: "POST",
            headers: { "xi-api-key": apiKey, "content-type": "application/json" },
            body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
        },
    );
    if (!response.ok) {
        throw new Error(`[smoke] ElevenLabs TTS ${response.status}: ${await response.text()}`);
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
class TenantMic {
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
 * Runs the smoke test against a fresh room and prints a report.
 */
async function main(): Promise<void> {
    const url = requireEnv("LIVEKIT_URL");
    const apiKey = requireEnv("LIVEKIT_API_KEY");
    const apiSecret = requireEnv("LIVEKIT_API_SECRET");
    const elevenKey = requireEnv("ELEVEN_API_KEY");

    console.log("[smoke] synthesizing tenant audio…");
    const tenantAudio = await Promise.all(TENANT_LINES.map((line) => synthesizeTenantPcm(line.text, elevenKey)));

    const roomName = `smoke-${Date.now()}`;
    const rooms = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
    await rooms.createRoom({ name: roomName, emptyTimeout: 60 });

    const token = new AccessToken(apiKey, apiSecret, { identity: "tenant-smoke", name: "Jordan (smoke)" });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    const room = new Room();
    let agentState = "initializing";
    let speakingTransitions = 0;
    let lastSpeakingAt = 0;
    let lastVoicedAt = 0;
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

    room.on(RoomEvent.ParticipantAttributesChanged, (changed: Record<string, string>, participant: Participant) => {
        if (participant.identity !== "tenant-smoke") {
            onAgentAttributes(changed);
        }
    });
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, participant: RemoteParticipant) => {
        if (track.kind !== TrackKind.KIND_AUDIO) {
            return;
        }
        console.log(`[smoke] subscribed to audio from ${participant.identity}`);
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
        if (info.identity === "tenant-smoke") {
            return;
        }
        void reader.readAll().then((text) => {
            if (text.trim()) {
                agentTranscripts.push(text.trim());
                console.log(`[smoke]   agent said: ${text.trim()}`);
            }
        });
    });

    await room.connect(url, await token.toJwt(), { autoSubscribe: true, dynacast: false });
    const mic = new TenantMic();
    const micTrack = LocalAudioTrack.createAudioTrack("tenant-mic", mic.source);
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant?.publishTrack(micTrack, publishOptions);
    const micLoop = mic.run();
    const joinedAt = Date.now();
    console.log(`[smoke] joined ${roomName}; waiting for agent…`);

    const results: TLineResult[] = [];
    let greeted = false;
    let greetingLatencyMs: number | undefined;
    try {
        await waitFor("agent participant", () => room.remoteParticipants.size > 0);
        for (const participant of room.remoteParticipants.values()) {
            onAgentAttributes(participant.attributes);
        }
        await waitFor("greeting audio", () => voicedEvents.length > 0);
        greeted = true;
        greetingLatencyMs = voicedEvents[0] - joinedAt;
        await waitFor("greeting to finish", () => agentState === "listening" && Date.now() - lastVoicedAt > 800);
        const greetingTranscripts = agentTranscripts.length;
        console.log(`[smoke] greeting heard (${greetingTranscripts} transcript segment(s))`);

        for (const [index, line] of TENANT_LINES.entries()) {
            if (line.bargeIn) {
                await waitFor("agent speaking before barge-in", () => agentState === "speaking");
                await sleep(BARGE_IN_DELAY_MS);
            }
            const transitionsBefore = speakingTransitions;
            const transcriptsBefore = agentTranscripts.length;
            const voicedBefore = voicedEvents.length;
            const startedAt = Date.now();
            console.log(`[smoke] tenant: ${line.text}`);
            const tenantEndedAt = await mic.speak(tenantAudio[index]);

            const result: TLineResult = { text: line.text, replies: 0, agentText: [] };
            if (line.bargeIn) {
                await waitFor("agent to stop after barge-in", () => Date.now() - lastVoicedAt > 400, 10_000);
                result.agentStoppedAfterBargeInMs = Math.max(0, lastVoicedAt - startedAt);
            }

            await waitFor(
                "agent reply",
                () => speakingTransitions > transitionsBefore && lastSpeakingAt > tenantEndedAt,
            );
            await waitFor("first agent audio", () => voicedEvents.some((at) => at > tenantEndedAt));
            result.latencyMs = (voicedEvents.find((at) => at > tenantEndedAt) ?? 0) - tenantEndedAt;

            const nextBargesIn = TENANT_LINES[index + 1]?.bargeIn === true;
            if (!nextBargesIn) {
                await waitFor("reply to finish", () => agentState === "listening" && Date.now() - lastVoicedAt > 800);
                await sleep(SETTLE_MS);
            }
            result.replies = speakingTransitions - transitionsBefore;
            result.agentText = agentTranscripts.slice(transcriptsBefore);
            if (voicedEvents.length === voicedBefore) {
                result.replies = 0;
            }
            results.push(result);
        }
    } finally {
        console.log("\n===== voice smoke report =====");
        console.log(`room: ${roomName}`);
        console.log(`greeting: ${greeted ? "yes" : "NO"}${greetingLatencyMs === undefined ? "" : ` (first audio ${greetingLatencyMs} ms after tenant joined)`}`);
        for (const [index, result] of results.entries()) {
            const bargeIn = result.agentStoppedAfterBargeInMs === undefined
                ? ""
                : `, barge-in: last agent audio heard ${result.agentStoppedAfterBargeInMs} ms after tenant started (incl. network + jitter buffer)`;
            console.log(
                `line ${index + 1}: replies=${result.replies}, end-of-tenant-audio → first agent audio=${result.latencyMs} ms${bargeIn}`,
            );
            console.log(`  tenant: ${result.text}`);
            for (const text of result.agentText) {
                console.log(`  agent:  ${text}`);
            }
        }
        const allSingle = results.length === TENANT_LINES.length && results.every((r) => r.replies === 1);
        console.log(`verdict: ${greeted && allSingle ? "PASS" : "FAIL"}`);

        mic.stop();
        await micLoop.catch(() => undefined);
        await room.disconnect();
        await rooms.deleteRoom(roomName).catch(() => undefined);
        await dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
