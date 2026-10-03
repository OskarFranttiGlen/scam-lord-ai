/**
 * @module voice/inbound-caller
 *
 * Recognises an inbound phone callback in a LiveKit room. The callback dispatch rule
 * (`scripts/setup-livekit-inbound.ts`) puts each inbound SIP call in its own room named
 * `callback-…`; the caller joins as a SIP participant whose `sip.phoneNumber` attribute is the
 * number they called from (docs.livekit.io → SIP participant attributes).
 *
 * Depends on: @livekit/rtc-node, ./outbound-call
 * Used by: @/voice/worker.ts, scripts/callback-smoke.ts
 */

import { ParticipantKind } from "@livekit/rtc-node";

import { TENANT_SIP_PARTICIPANT_IDENTITY } from "./outbound-call";

/** Room-name prefix set by the inbound dispatch rule. */
export const CALLBACK_ROOM_PREFIX = "callback-";

/** Caller's number on an inbound SIP participant (absent when the rule hides numbers). */
export const SIP_PHONE_NUMBER_ATTRIBUTE = "sip.phoneNumber";

/**
 * Env flag that lets a non-SIP participant's `sip.phoneNumber` attribute count, so
 * `scripts/callback-smoke.ts` can simulate a callback without Twilio. Dev only: any token
 * holder can set attributes, so production must leave it unset.
 */
export const FAKE_SIP_CALLERS_ENV = "VOICE_DEV_FAKE_SIP_CALLERS";

export type TInboundCaller = {
    identity: string;
    /** E.164 caller number, or `null` when hidden, unparseable, or untrusted. */
    phoneNumber: string | null;
};

export type TCallerParticipant = {
    identity: string;
    kind: ParticipantKind;
    attributes: Record<string, string>;
};

export type TDetectInboundCallerOptions = {
    /** Trust `sip.phoneNumber` on non-SIP participants (smoke tests). */
    allowFakeSipCallers?: boolean;
};

/**
 * True when the room was created by the callback dispatch rule.
 *
 * @param roomName - LiveKit room name
 */
export function isCallbackRoom(roomName: string): boolean {
    return roomName.startsWith(CALLBACK_ROOM_PREFIX);
}

/**
 * True when {@link FAKE_SIP_CALLERS_ENV} is set to `1` or `true`.
 */
export function fakeSipCallersAllowed(): boolean {
    const value = process.env[FAKE_SIP_CALLERS_ENV]?.trim().toLowerCase();
    return value === "1" || value === "true";
}

/**
 * Normalises a caller number to E.164. Ten-digit numbers are taken as North American (+1).
 * Returns `null` for withheld or too-short numbers.
 *
 * @param raw - Number as given by SIP or a database row, e.g. `(555) 555-0201` or `sip:+1…@host`
 */
export function normalizePhoneE164(raw: string): string | null {
    const user = raw.trim().replace(/^sips?:/i, "").replace(/@.*$/, "");
    const digits = user.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
        return null;
    }
    if (user.startsWith("+")) {
        return `+${digits}`;
    }
    if (digits.length === 10) {
        return `+1${digits}`;
    }
    return `+${digits}`;
}

/**
 * Returns the inbound caller when `participant` is the person who phoned in, else `null`.
 * The number is only trusted from a SIP participant (or with the dev override).
 *
 * @param roomName - Room the participant joined
 * @param participant - Remote participant (identity, kind, attributes)
 * @param options - Dev override for simulated callers
 */
export function detectInboundCaller(
    roomName: string,
    participant: TCallerParticipant,
    options: TDetectInboundCallerOptions = {},
): TInboundCaller | null {
    if (!isCallbackRoom(roomName) || participant.identity === TENANT_SIP_PARTICIPANT_IDENTITY) {
        return null;
    }
    const trusted = participant.kind === ParticipantKind.SIP || options.allowFakeSipCallers === true;
    const raw = participant.attributes[SIP_PHONE_NUMBER_ATTRIBUTE];
    return {
        identity: participant.identity,
        phoneNumber: trusted && raw ? normalizePhoneE164(raw) : null,
    };
}
