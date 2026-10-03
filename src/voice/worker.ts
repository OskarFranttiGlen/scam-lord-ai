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
import { TelephonyBackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";
import { RoomEvent, type Participant, type RemoteParticipant } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";

import { getStripeClient } from "@/payments/stripe";
import { createCollectionVoiceAgent } from "./agent";
import { loadFollowUp, recordCallNotes } from "./call-notes";
import { ChunkSentenceTokenizer } from "./chunk-tokenizer";
import { createInitialCallState, type CallContext, type CallState } from "./context";
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
import { watchForPayment } from "./payment-watch";
import { persistCall } from "./persist-call";
import { replaySkippedSpeech } from "./replay-skipped-speech";
import { getVoiceSupabaseClient } from "./supabase-client";
import { waitForFulfilment } from "./tools";
import { UNKNOWN_CALLER_GREETING, UnknownCallerAgent } from "./unknown-caller";

const LIVEKIT_ENV_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/** "Mia - Warm, approachable & natural" (ElevenLabs shared library; must be added to the account's voices). */
const DEFAULT_ELEVEN_VOICE_ID = "cr0sIcub5EqRc36Kj15s";

/** Strips other voices in the room (TV, office, PA) so only the caller can interrupt. Needs LiveKit Cloud. */
const TENANT_INPUT = { noiseCancellation: TelephonyBackgroundVoiceCancellation() };

/** Pause after an unknown caller's closing line before the room (and phone call) is ended. */
const UNKNOWN_CALLER_HANGUP_DELAY_MS = 800;

/**
 * Notes and broken promises from the tenancy's earlier conversations, when there are any.
 *
 * @param tenancyId - Tenancy row id, when known
 * @param openBalance - Balance on this call; nothing owed means no broken promises
 */
async function loadFollowUpFor(tenancyId: string | null | undefined, openBalance: number) {
    const client = getVoiceSupabaseClient();
    if (!tenancyId || !client) {
        return undefined;
    }
    return loadFollowUp(client, tenancyId, {
        today: new Date().toISOString().slice(0, 10),
        stillOwing: openBalance > 0,
    });
}
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

// The image build runs `download-files` without credentials.
if (process.argv[2] !== "download-files") {
    requireLiveKitEnv();
}

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
 * Ends the phone call from the agent's side once it says goodbye: after the end_call tool
 * flags the state, wait for the agent to finish speaking (back to "listening"), then delete
 * the room after the same closing delay the unknown-caller hangup uses.
 *
 * @param ctx - Job context for the call room
 * @param session - Voice session running the collection agent
 * @param callState - Call state; `callEnded` is set by the end_call tool
 */
function hangUpAfterGoodbye(ctx: JobContext, session: voice.AgentSession, callState: CallState): void {
    const logger = log();
    let hangingUp = false;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
        if (!callState.callEnded || ev.newState !== "listening" || hangingUp) {
            return;
        }
        hangingUp = true;
        setTimeout(() => {
            ctx.deleteRoom().catch((error: unknown) => {
                logger.warn({ error }, "[voice/worker] could not hang up after goodbye");
            });
        }, UNKNOWN_CALLER_HANGUP_DELAY_MS);
    });
}

/**
 * Watches Stripe so a payment made during the call is announced live, only when a Stripe
 * client is configured. The returned stop handle belongs in the job's shutdown callback.
 *
 * @param context - Tenancy and invoice snapshot
 * @param callState - Call state the plan is accepted on
 * @param session - Voice session running the collection agent
 */
function startPaymentWatch(
    context: CallContext,
    callState: CallState,
    session: voice.AgentSession,
): (() => void) | undefined {
    const stripe = getStripeClient();
    return stripe ? watchForPayment({ state: callState, stripe, session, context }) : undefined;
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
            // A trailing "um" tells the turn detector the tenant is mid-thought, not done.
            fillerWords: true,
        }),
        tts: new elevenlabs.TTS({
            voiceId: process.env.ELEVEN_VOICE_ID?.trim() || DEFAULT_ELEVEN_VOICE_ID,
            // Flash garbled shared-library voices (dropped and slurred words) on calls.
            model: process.env.ELEVEN_MODEL?.trim() || "eleven_turbo_v2_5",
            // Mia's recommended settings, slowed a little for phone calls.
            voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.9 },
            wordTokenizer: new ChunkSentenceTokenizer(),
        }),
        turnHandling: {
            turnDetection: useVadTurns ? "vad" : new inference.TurnDetector(),
            // Tenants pause mid-sentence ("um"); replying after 300 ms made them talk over the reply.
            endpointing: useVadTurns ? { minDelay: 800, maxDelay: 3000 } : { minDelay: 700, maxDelay: 3000 },
            // Uninterruptible replies made every answer land one turn late, so real replies interrupt.
            // Only transcribed words count (two or more): adaptive mode and false-interruption pausing
            // both paused the reply on an "uhh" or line noise and chopped it.
            interruption: {
                enabled: true,
                mode: "vad",
                minWords: 2,
                minDuration: 600,
                resumeFalseInterruption: false,
            },
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
    replaySkippedSpeech(session);
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
        await session.start({ agent, room: ctx.room, inputOptions: TENANT_INPUT });
        session.say(UNKNOWN_CALLER_GREETING);
        return;
    }

    const { tenancyId, handoff, priorConversation } = setup;
    const checkIn = await loadCheckInContext({ tenancyId, phone: setup.callContext.phone });
    const followUp = await loadFollowUpFor(tenancyId, setup.callContext.openBalance);
    const callContext = {
        ...setup.callContext,
        maintenanceRequests: checkIn.maintenanceRequests ?? [],
        ...(followUp ? { followUp } : {}),
    };
    const callState = createInitialCallState();
    callState.handoffActive = handoff.active;
    callState.feedbackRecorded = checkIn.recentFeedback;
    const greeting = buildCallbackGreeting(callContext, { handoffActive: handoff.active });

    // A const handle would still be uninitialized if shutdown fires before session.start
    // (e.g. an unanswered call), so the stop lands in this holder once the watch starts.
    const paymentWatchStops: Array<() => void> = [];
    ctx.addShutdownCallback(async () => {
        paymentWatchStops.forEach(stop => stop());
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
        await recordCallNotes({ roomName, state: callState });
    });

    const agent = new ScamLordVoiceAgent({
        brain: createCollectionVoiceAgent({ context: callContext, state: callState }),
        state: callState,
        greeting,
        priorConversation,
    });
    attachLatencyLog(session, agent);
    await session.start({ agent, room: ctx.room, inputOptions: TENANT_INPUT });
    hangUpAfterGoodbye(ctx, session, callState);
    const stopPaymentWatch = startPaymentWatch(callContext, callState, session);
    if (stopPaymentWatch) {
        paymentWatchStops.push(stopPaymentWatch);
    }
    session.say(greeting);
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
        const followUp = await loadFollowUpFor(checkIn.tenancyId, setup.callContext.openBalance);
        const callContext = {
            ...setup.callContext,
            maintenanceRequests: checkIn.maintenanceRequests ?? setup.callContext.maintenanceRequests,
            ...(followUp ? { followUp } : {}),
        };
        const callState = createInitialCallState();
        const greeting = buildOpeningGreeting(callContext);

        // A const handle would still be uninitialized if shutdown fires before session.start
        // (e.g. an unanswered call), so the stop lands in this holder once the watch starts.
        const paymentWatchStops: Array<() => void> = [];
        ctx.addShutdownCallback(async () => {
            paymentWatchStops.forEach(stop => stop());
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
            await recordCallNotes({ roomName, state: callState });
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

        await session.start({ agent, room: ctx.room, inputOptions: TENANT_INPUT });
        hangUpAfterGoodbye(ctx, session, callState);
        const stopPaymentWatch = startPaymentWatch(callContext, callState, session);
        if (stopPaymentWatch) {
            paymentWatchStops.push(stopPaymentWatch);
        }
        session.say(greeting);
    },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
