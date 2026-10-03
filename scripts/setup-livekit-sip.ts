/**
 * @module scripts/setup-livekit-sip
 *
 * Idempotently creates (or updates) the LiveKit **outbound SIP trunk** that sends calls to
 * Twilio Elastic SIP Trunking, then prints the trunk id for `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`.
 * An existing trunk with the same Twilio termination domain is updated in place, so re-running
 * keeps the same id.
 *
 * Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TWILIO_SIP_TRUNK_DOMAIN`
 * (e.g. `scamlord.pstn.twilio.com`), `TWILIO_SIP_USERNAME`, `TWILIO_SIP_PASSWORD`
 * (the Twilio credential list entry), `TWILIO_PHONE_NUMBER` (E.164 caller id on the trunk).
 *
 * Run:
 * ```bash
 * npx tsx scripts/setup-livekit-sip.ts
 * ```
 *
 * Depends on: dotenv, livekit-server-sdk
 * Used by: one-time telephony setup
 */

import "dotenv/config";

import { type CreateSipOutboundTrunkOptions, SipClient } from "livekit-server-sdk";

const TRUNK_NAME = "ScamLord Twilio outbound";
/** `SIPTransport.SIP_TRANSPORT_AUTO`; the SDK's own protocol copy is not importable directly. */
const SIP_TRANSPORT_AUTO: CreateSipOutboundTrunkOptions["transport"] = 0;

const REQUIRED_ENV = [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "TWILIO_SIP_TRUNK_DOMAIN",
    "TWILIO_SIP_USERNAME",
    "TWILIO_SIP_PASSWORD",
    "TWILIO_PHONE_NUMBER",
] as const;

type TRequiredEnv = Record<(typeof REQUIRED_ENV)[number], string>;

/**
 * Reads all required env vars or exits listing the missing ones.
 */
function readEnv(): TRequiredEnv {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
    if (missing.length > 0) {
        console.error(`[setup-livekit-sip] Missing env: ${missing.join(", ")}`);
        process.exit(1);
    }
    return Object.fromEntries(REQUIRED_ENV.map((key) => [key, process.env[key]?.trim() ?? ""])) as TRequiredEnv;
}

/**
 * Strips any `sip:` scheme or trailing path the user pasted from the Twilio console.
 *
 * @param domain - Twilio termination SIP URI or bare domain
 */
function normalizeDomain(domain: string): string {
    return domain.replace(/^sips?:/i, "").replace(/[/;].*$/, "").toLowerCase();
}

/**
 * Creates or updates the outbound trunk and prints its id.
 */
async function main(): Promise<void> {
    const env = readEnv();
    const address = normalizeDomain(env.TWILIO_SIP_TRUNK_DOMAIN);
    if (!address.endsWith(".pstn.twilio.com")) {
        console.warn(`[setup-livekit-sip] ${address} does not end in .pstn.twilio.com; continuing anyway.`);
    }
    const numbers = [env.TWILIO_PHONE_NUMBER];
    const sip = new SipClient(env.LIVEKIT_URL.replace(/^ws/, "http"), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

    const existing = (await sip.listSipOutboundTrunk()).find(
        (trunk) => trunk.address.toLowerCase() === address || trunk.name === TRUNK_NAME,
    );

    let trunkId: string;
    if (existing) {
        existing.name = TRUNK_NAME;
        existing.address = address;
        existing.numbers = numbers;
        existing.transport = SIP_TRANSPORT_AUTO;
        existing.authUsername = env.TWILIO_SIP_USERNAME;
        existing.authPassword = env.TWILIO_SIP_PASSWORD;
        const updated = await sip.updateSipOutboundTrunk(existing.sipTrunkId, existing);
        trunkId = updated.sipTrunkId;
        console.log(`[setup-livekit-sip] Updated existing outbound trunk ${trunkId} → ${address}`);
    } else {
        const created = await sip.createSipOutboundTrunk(TRUNK_NAME, address, numbers, {
            transport: SIP_TRANSPORT_AUTO,
            authUsername: env.TWILIO_SIP_USERNAME,
            authPassword: env.TWILIO_SIP_PASSWORD,
        });
        trunkId = created.sipTrunkId;
        console.log(`[setup-livekit-sip] Created outbound trunk ${trunkId} → ${address}`);
    }

    console.log(`\nAdd this to .env (and Doppler):\nLIVEKIT_SIP_OUTBOUND_TRUNK_ID=${trunkId}`);
}

main().catch((error: unknown) => {
    console.error(`[setup-livekit-sip] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
