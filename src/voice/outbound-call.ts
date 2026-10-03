/**
 * @module voice/outbound-call
 *
 * Places a real collection phone call: creates a LiveKit room whose metadata carries
 * `{ callContext }` (the worker auto-joins every new room and reads it), then dials the tenant
 * into that room through the LiveKit outbound SIP trunk (Twilio Elastic SIP Trunking).
 *
 * Returns as soon as the dial is placed; it does not wait for pickup, so the Stripe webhook can
 * respond quickly. The worker must hold the greeting until the SIP participant
 * ({@link TENANT_SIP_PARTICIPANT_IDENTITY}) has `sip.callStatus === "active"`.
 *
 * Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`
 * (create it with `scripts/setup-livekit-sip.ts`).
 *
 * Depends on: livekit-server-sdk, ./context
 * Used by: Stripe invoice webhook, scripts/call-tenant.ts
 */

import { RoomServiceClient, SipClient } from "livekit-server-sdk";

import type { CallContext } from "./context";

/** Fixed per-room identity of the dialed tenant, so the worker can wait for it by name. */
export const TENANT_SIP_PARTICIPANT_IDENTITY = "tenant";

/** Seconds the room stays open if nobody ever joins (dial failed before connecting). */
const ROOM_EMPTY_TIMEOUT_S = 60;
/** Seconds the room stays open after the last participant leaves. */
const ROOM_DEPARTURE_TIMEOUT_S = 10;
/** Seconds the tenant's phone rings before LiveKit gives up. */
const RINGING_TIMEOUT_S = 30;
/** Hard cap on call length. */
const MAX_CALL_DURATION_S = 15 * 60;

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export type TStartCollectionCallInput = {
    /** E.164, e.g. `+15555550102`. */
    toPhoneNumber: string;
    callContext: CallContext;
};

/** Room metadata JSON the worker parses to learn who it is calling. */
export type TCollectionRoomMetadata = {
    callContext: CallContext;
};

type TLiveKitConfig = {
    host: string;
    apiKey: string;
    apiSecret: string;
    trunkId: string;
};

/**
 * Reads LiveKit + SIP trunk env, throwing a message that names every missing key.
 */
function readLiveKitConfig(): TLiveKitConfig {
    const url = process.env.LIVEKIT_URL?.trim();
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const trunkId = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID?.trim();
    if (!url || !apiKey || !apiSecret || !trunkId) {
        const missing = [
            !url && "LIVEKIT_URL",
            !apiKey && "LIVEKIT_API_KEY",
            !apiSecret && "LIVEKIT_API_SECRET",
            !trunkId && "LIVEKIT_SIP_OUTBOUND_TRUNK_ID",
        ].filter(Boolean);
        const hint = trunkId ? "" : " (run `npx tsx scripts/setup-livekit-sip.ts` to create the outbound trunk)";
        throw new Error(`Cannot place collection call: missing ${missing.join(", ")}${hint}`);
    }
    return { host: url.replace(/^ws/, "http"), apiKey, apiSecret, trunkId };
}

/**
 * Unique, URL-safe room name tied to the Stripe invoice for log correlation.
 *
 * @param stripeInvoiceId - Invoice the call is about
 */
function buildRoomName(stripeInvoiceId: string): string {
    const invoice = stripeInvoiceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "invoice";
    return `collect-${invoice}-${Date.now().toString(36)}`;
}

/**
 * Creates the call room (metadata `{ callContext }`) and dials the tenant into it over SIP.
 * The stored `callContext.phone` is set to the dialed number so the payment-link SMS reaches
 * whoever answered. Deletes the room and rethrows if the dial request fails.
 *
 * @param input - Number to dial and the tenancy/invoice snapshot for the agent
 */
export async function startCollectionCall(input: {
    toPhoneNumber: string; // E.164
    callContext: CallContext;
}): Promise<{ roomName: string }> {
    const toPhoneNumber = input.toPhoneNumber.trim();
    if (!E164_PATTERN.test(toPhoneNumber)) {
        throw new Error(`Cannot place collection call: "${toPhoneNumber}" is not an E.164 number like +15555550102`);
    }
    const { host, apiKey, apiSecret, trunkId } = readLiveKitConfig();

    const roomName = buildRoomName(input.callContext.stripeInvoiceId);
    const metadata: TCollectionRoomMetadata = { callContext: { ...input.callContext, phone: toPhoneNumber } };

    const rooms = new RoomServiceClient(host, apiKey, apiSecret);
    await rooms.createRoom({
        name: roomName,
        metadata: JSON.stringify(metadata),
        emptyTimeout: ROOM_EMPTY_TIMEOUT_S,
        departureTimeout: ROOM_DEPARTURE_TIMEOUT_S,
    });

    const sip = new SipClient(host, apiKey, apiSecret);
    try {
        await sip.createSipParticipant(trunkId, toPhoneNumber, roomName, {
            participantIdentity: TENANT_SIP_PARTICIPANT_IDENTITY,
            participantName: input.callContext.tenantName,
            ringingTimeout: RINGING_TIMEOUT_S,
            maxCallDuration: MAX_CALL_DURATION_S,
            waitUntilAnswered: false,
        });
    } catch (error) {
        await rooms.deleteRoom(roomName).catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot place collection call to ${toPhoneNumber}: SIP dial failed: ${reason}`, { cause: error });
    }

    return { roomName };
}
