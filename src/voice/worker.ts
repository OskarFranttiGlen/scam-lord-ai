/**
 * @module voice/worker
 *
 * LiveKit Agents worker: Deepgram STT, Silero VAD, LiveKit audio end-of-turn detector,
 * ElevenLabs TTS. LiveKit owns turn-taking and interruptions; {@link ScamLordVoiceAgent}
 * runs one {@link runVoiceTurn} per completed tenant turn. The disclosure-first greeting
 * (AI disclosure + balance, docs/SPEC.md) is templated and spoken as soon as the session starts.
 *
 * Start locally:
 * ```bash
 * npx tsx src/voice/worker.ts dev
 * ```
 * Or: `node scripts/run-voice-worker.mjs`
 *
 * Env: `ELEVEN_VOICE_ID` (optional, premade voices only on free tier),
 * `VOICE_TURN_DETECTION=vad` to fall back from the audio end-of-turn model to VAD endpointing.
 *
 * Call context comes from room metadata / Supabase ({@link loadCallSetup}); the call is written
 * to Supabase on job shutdown ({@link persistCall}).
 *
 * Inbound callbacks land in `callback-…` rooms (LiveKit dispatch rule). The worker waits for the
 * caller, maps `sip.phoneNumber` to a tenancy ({@link loadCallbackSetup}), and either picks up
 * the last conversation (carrying any handoff) or, for an unknown number, runs
 * {@link UnknownCallerAgent}, which reveals nothing and hangs up after taking a name.
 * `VOICE_DEV_FAKE_SIP_CALLERS=1` lets a non-SIP participant's phone attribute count (smoke tests).
 *
 * Depends on: @livekit/agents, plugin-deepgram, plugin-elevenlabs, plugin-silero, ./agent,
 * ./inbound-caller, ./livekit-agent, ./load-call-context, ./persist-call, ./unknown-caller
 * Used by: LiveKit Cloud / self-hosted agent dispatch
 */

import {
    type JobContext,
    type JobProcess,
    ServerOptions,
    cli,
    defineAgent,
    inference,
    log,
    voice,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as silero from "@livekit/agents-plugin-silero";
import { RoomEvent, type Participant, type RemoteParticipant } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";

import { createCollectionVoiceAgent } from "./agent";
import { ChunkSentenceTokenizer } from "./chunk-tokenizer";
import { createInitialCallState } from "./context";
import {
    SIP_PHONE_NUMBER_ATTRIBUTE,
    detectInboundCaller,
    fakeSipCallersAllowed,
    isCallbackRoom,
} from "./inbound-caller";
import { ScamLordVoiceAgent, buildCallbackGreeting, buildOpeningGreeting } from "./livekit-agent";
import { loadCallSetup, loadCallbackSetup } from "./load-call-context";
import { loadCheckInContext } from "./maintenance";
import { TENANT_SIP_PARTICIPANT_IDENTITY } from "./outbound-call";
import { persistCall } from "./persist-call";
import { waitForFulfilment } from "./tools";
import { UNKNOWN_CALLER_GREETING, UnknownCallerAgent } from "./unknown-caller";

const LIVEKIT_ENV_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/** Premade "Will"; ElevenLabs free tier returns 402 for library voices. */
const DEFAULT_ELEVEN_VOICE_ID = "bIHbv24MWmeRgasZH58o";

/** Pause after an unknown caller's closing line before the room (and phone call) is ended. */
const UNKNOWN_CALLER_HANGUP_DELAY_MS = 800;
/** How long to wait for a callback participant's phone attribute before treating it as withheld. */
const CALLER_ATTRIBUTES_TIMEOUT_MS = 2000;

/**
 * Exits the process when required LiveKit credentials are missing.
 */
function requireLiveKitEnv(): void {
    const missing = LIVEKIT_ENV_KEYS.filter((key) => !process.env[key]?.trim());
    if (missing.length === 0) {
        return;
    }

    console.error(
        `[voice/worker] Missing LiveKit configuration: ${missing.join(", ")}.\n`
        + "Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET, then restart the worker.",
    );
    process.exit(1);
}

requireLiveKitEnv();

/**
 * True when `VOICE_TURN_DETECTION=vad` opts out of the audio end-of-turn model.
 */
function isVadTurnDetection(): boolean {
    return process.env.VOICE_TURN_DETECTION === "vad";
}

/**
 * Formats seconds as rounded milliseconds for log lines.
 *
 * @param seconds - Duration in seconds, possibly undefined
 */
function toMs(seconds: number | undefined): number | undefined {
    return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

/**
 * Logs one line per spoken assistant reply: end-of-turn → brain → first audio.
 *
 * @param session - Voice session emitting conversation items
 * @param agent - Brain-backed agent exposing the latest turn timing, if any
 */
function attachLatencyLog(session: voice.AgentSession, agent?: ScamLordVoiceAgent): void {
    const logger = log();
    let turn = 0;

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
        const item = ev.item;
        if (item.type !== "message" || item.role !== "assistant") {
            return;
        }
        const timing = turn === 0 ? undefined : agent?.lastTiming;
        logger.info(
            {
                turn,
                eouToBrainMs: timing?.eouToBrainMs,
                brainMs: timing?.brainMs,
                ttsTtfbMs: toMs(item.metrics.ttsNodeTtfb),
                eouToFirstAudioMs: toMs(item.metrics.e2eLatency),
                interrupted: item.interrupted,
                brainFailed: timing?.failed,
            },
            turn === 0 ? "[voice/latency] greeting" : "[voice/latency] turn",
        );
        turn += 1;
    });
}

/**
 * Waits until the dialed tenant picks up. Resolves false if they hang up or never answer,
 * so the greeting is not spoken into a ringing line.
 *
 * @param ctx - Job context for the outbound call room
 */
async function waitForSipAnswer(ctx: JobContext): Promise<boolean> {
    const tenant = await ctx.waitForParticipant(TENANT_SIP_PARTICIPANT_IDENTITY);
    if (tenant.attributes["sip.callStatus"] === "active") {
        return true;
    }
    return new Promise<boolean>((resolve) => {
        const finish = (answered: boolean) => {
            ctx.room.off(RoomEvent.ParticipantAttributesChanged, onAttributes);
            ctx.room.off(RoomEvent.ParticipantDisconnected, onLeft);
            resolve(answered);
        };
        const onAttributes = (_changed: Record<string, string>, participant: Participant) => {
            if (participant.identity === TENANT_SIP_PARTICIPANT_IDENTITY
                && participant.attributes["sip.callStatus"] === "active") {
                finish(true);
            }
        };
        const onLeft = (participant: RemoteParticipant) => {
            if (participant.identity === TENANT_SIP_PARTICIPANT_IDENTITY) {
                finish(false);
            }
        };
        ctx.room.on(RoomEvent.ParticipantAttributesChanged, onAttributes);
        ctx.room.on(RoomEvent.ParticipantDisconnected, onLeft);
    });
}

/**
 * Waits up to {@link CALLER_ATTRIBUTES_TIMEOUT_MS} for the caller's `sip.phoneNumber`, which can
 * land after the participant is first visible. Resolves either way; a missing number means an
 * unknown caller.
 *
 * @param ctx - Job context for the callback room
 * @param participant - The caller
 */
async function waitForCallerPhone(ctx: JobContext, participant: RemoteParticipant): Promise<void> {
    if (participant.attributes[SIP_PHONE_NUMBER_ATTRIBUTE]) {
        return;
    }
    await new Promise<void>((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            ctx.room.off(RoomEvent.ParticipantAttributesChanged, onAttributes);
            resolve();
        };
        const onAttributes = (_changed: Record<string, string>, changedParticipant: Participant) => {
            if (changedParticipant.identity === participant.identity
                && changedParticipant.attributes[SIP_PHONE_NUMBER_ATTRIBUTE]) {
                finish();
            }
        };
        const timer = setTimeout(finish, CALLER_ATTRIBUTES_TIMEOUT_MS);
        ctx.room.on(RoomEvent.ParticipantAttributesChanged, onAttributes);
    });
}

/**
 * Voice session with the shared STT, TTS, and turn-taking setup, logging unrecoverable errors.
 *
 * @param ctx - Job context (prewarmed VAD)
 */
function createVoiceSession(ctx: JobContext): voice.AgentSession {
    const useVadTurns = isVadTurnDetection();
    const session = new voice.AgentSession({
        vad: ctx.proc.userData.vad as silero.VAD,
        stt: new deepgram.STT({
            model: "nova-3",
            language: "en",
            punctuate: true,
            smartFormat: true,
        }),
        tts: new elevenlabs.TTS({
            voiceId: process.env.ELEVEN_VOICE_ID?.trim() || DEFAULT_ELEVEN_VOICE_ID,
            model: "eleven_flash_v2_5",
            wordTokenizer: new ChunkSentenceTokenizer(),
        }),
        turnHandling: {
            turnDetection: useVadTurns ? "vad" : new inference.TurnDetector(),
            endpointing: useVadTurns ? { minDelay: 450, maxDelay: 2000 } : { minDelay: 300, maxDelay: 2000 },
            // Phone backchannels ("okay", "yeah") and line noise otherwise cut the agent off mid-sentence.
            interruption: { enabled: true, minWords: 2 },
            // Preemptive generation would call llmNode before end of turn and run the brain twice.
            preemptiveGeneration: { enabled: false },
        },
    });
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
        if (ev.error.recoverable) {
            return;
        }
        log().error({ error: ev.error }, "[voice/worker] unrecoverable session error");
    });
    return session;
}

/**
 * Answers an inbound callback: known callers resume their conversation (stored with channel
 * `callback`); unknown callers get {@link UnknownCallerAgent} and are hung up on after closing.
 *
 * @param ctx - Job context for the `callback-…` room
 * @param roomName - Room name, also the `calls` upsert key
 * @param startedAt - When the job started
 */
async function answerCallback(ctx: JobContext, roomName: string, startedAt: Date): Promise<void> {
    const logger = log();
    const participant = await ctx.waitForParticipant();
    await waitForCallerPhone(ctx, participant);
    const caller = detectInboundCaller(roomName, participant, { allowFakeSipCallers: fakeSipCallersAllowed() });
    const setup = await loadCallbackSetup(caller?.phoneNumber ?? null);
    logger.info(
        {
            room: roomName,
            caller: participant.identity,
            callerNumberPresent: Boolean(caller?.phoneNumber),
            kind: setup.kind,
            tenancyId: setup.kind === "known" ? setup.tenancyId : undefined,
            handoff: setup.kind === "known" ? setup.handoff : undefined,
        },
        "[voice/worker] callback caller resolved",
    );
    const session = createVoiceSession(ctx);

    if (setup.kind === "unknown") {
        const agent = new UnknownCallerAgent();
        ctx.addShutdownCallback(async () => {
            logger.info(
                { room: roomName, phoneNumber: setup.phoneNumber, transcript: agent.transcriptLines },
                "[voice/worker] unknown callback caller; no tenancy, call not persisted",
            );
        });
        let hangingUp = false;
        session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
            if (!agent.done || ev.newState !== "listening" || hangingUp) {
                return;
            }
            hangingUp = true;
            setTimeout(() => {
                ctx.deleteRoom().catch((error: unknown) => {
                    logger.warn({ error }, "[voice/worker] could not end unknown callback");
                });
            }, UNKNOWN_CALLER_HANGUP_DELAY_MS);
        });
        attachLatencyLog(session);
        await session.start({ agent, room: ctx.room });
        session.say(UNKNOWN_CALLER_GREETING, { allowInterruptions: true });
        return;
    }

    const { tenancyId, handoff, priorConversation } = setup;
    const checkIn = await loadCheckInContext({ tenancyId, phone: setup.callContext.phone });
    const callContext = { ...setup.callContext, maintenanceRequests: checkIn.maintenanceRequests ?? [] };
    const callState = createInitialCallState();
    callState.handoffActive = handoff.active;
    callState.feedbackRecorded = checkIn.recentFeedback;
    const greeting = buildCallbackGreeting(callContext, { handoffActive: handoff.active });

    ctx.addShutdownCallback(async () => {
        await waitForFulfilment(callState);
        await persistCall({
            roomName,
            callContext,
            state: callState,
            startedAt,
            endedAt: new Date(),
            tenancyId,
            channel: "callback",
            carriedHandoffReason: handoff.reason,
        });
    });

    const agent = new ScamLordVoiceAgent({
        brain: createCollectionVoiceAgent({ context: callContext, state: callState }),
        state: callState,
        greeting,
        priorConversation,
    });
    attachLatencyLog(session, agent);
    await session.start({ agent, room: ctx.room });
    session.say(greeting, { allowInterruptions: true });
}

export default defineAgent({
    prewarm: async (proc: JobProcess) => {
        // The turn detector decides end of turn; VAD silence only gates it (floor is 250 ms).
        proc.userData.vad = await silero.VAD.load(
            isVadTurnDetection() ? {} : { minSilenceDuration: 300 },
        );
    },

    entry: async (ctx: JobContext) => {
        await ctx.connect();

        const logger = log();
        const startedAt = new Date();
        const roomName = ctx.room.name ?? ctx.job.room?.name ?? `job-${ctx.job.id}`;
        if (isCallbackRoom(roomName)) {
            await answerCallback(ctx, roomName, startedAt);
            return;
        }

        const setup = await loadCallSetup(ctx.room.metadata ?? ctx.job.room?.metadata);
        logger.info({ room: roomName, source: setup.source, tenancyId: setup.tenancyId }, "[voice/worker] call context loaded");
        const checkIn = await loadCheckInContext({ tenancyId: setup.tenancyId, phone: setup.callContext.phone });
        const callContext = {
            ...setup.callContext,
            maintenanceRequests: checkIn.maintenanceRequests ?? setup.callContext.maintenanceRequests,
        };
        const callState = createInitialCallState();
        const greeting = buildOpeningGreeting(callContext);

        ctx.addShutdownCallback(async () => {
            await waitForFulfilment(callState);
            await persistCall({
                roomName,
                callContext,
                state: callState,
                startedAt,
                endedAt: new Date(),
                tenancyId: setup.tenancyId,
                channel: "outbound_call",
            });
        });

        const agent = new ScamLordVoiceAgent({
            brain: createCollectionVoiceAgent({ context: callContext, state: callState }),
            state: callState,
            greeting,
        });
        const session = createVoiceSession(ctx);
        attachLatencyLog(session, agent);

        const isPhoneCall = ctx.room.remoteParticipants.has(TENANT_SIP_PARTICIPANT_IDENTITY)
            || setup.source === "room_metadata";
        if (isPhoneCall && !(await waitForSipAnswer(ctx))) {
            logger.info({ room: roomName }, "[voice/worker] tenant did not answer");
            ctx.shutdown("no_answer");
            return;
        }

        await session.start({ agent, room: ctx.room });
        session.say(greeting, { allowInterruptions: true });
    },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
