/**
 * @module scripts/setup-livekit-inbound
 *
 * Idempotently creates (or updates) what LiveKit needs to answer tenant callbacks:
 * 1. An **inbound SIP trunk** for `TWILIO_PHONE_NUMBER`, so calls Twilio originates to the
 *    project's SIP URI are accepted. Optionally restricted to `LIVEKIT_SIP_INBOUND_ALLOWED_ADDRESSES`
 *    (comma-separated IPs/CIDRs, e.g. Twilio's signalling ranges for your edge).
 * 2. A **dispatch rule** that puts every inbound call in its own room prefixed `callback-`. The
 *    worker auto-joins every new room and treats `callback-…` rooms as callbacks.
 *
 * Re-running keeps the same ids. Without `TWILIO_PHONE_NUMBER` (or with `--all-numbers`) the rule
 * is created without a trunk filter, so it also answers LiveKit Phone Numbers (the fallback when
 * Twilio is not set up). LiveKit allows only one rule per trunk/number without a PIN, so an
 * unrelated rule on the same trunk makes creation fail: delete it in the LiveKit console first.
 *
 * Env: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; optional `TWILIO_PHONE_NUMBER`
 * (E.164), `LIVEKIT_SIP_INBOUND_ALLOWED_ADDRESSES`.
 *
 * Run:
 * ```bash
 * npx tsx scripts/setup-livekit-inbound.ts [--all-numbers]
 * ```
 *
 * Depends on: dotenv, livekit-server-sdk, src/voice/inbound-caller
 * Used by: one-time telephony setup
 */

import "dotenv/config";

import { SipClient } from "livekit-server-sdk";

import { CALLBACK_ROOM_PREFIX } from "../src/voice/inbound-caller";

const TRUNK_NAME = "ScamLord Twilio inbound";
const RULE_NAME = "ScamLord callbacks";
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/**
 * Reads a required env var or exits.
 *
 * @param key - Environment variable name
 */
function requireEnv(key: string): string {
    const value = process.env[key]?.trim();
    if (!value) {
        console.error(`[setup-livekit-inbound] Missing env ${key}`);
        process.exit(1);
    }
    return value;
}

/**
 * Comma-separated env list, trimmed, without empties.
 *
 * @param key - Environment variable name
 */
function envList(key: string): string[] {
    return (process.env[key] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Creates or updates the inbound trunk for the Twilio number and returns its id.
 *
 * @param sip - LiveKit SIP client
 * @param phoneNumber - Twilio number in E.164
 * @param allowedAddresses - Optional source IP/CIDR allowlist
 */
async function upsertInboundTrunk(sip: SipClient, phoneNumber: string, allowedAddresses: string[]): Promise<string> {
    const existing = (await sip.listSipInboundTrunk()).find(
        (trunk) => trunk.name === TRUNK_NAME || trunk.numbers.includes(phoneNumber),
    );
    if (existing) {
        existing.name = TRUNK_NAME;
        existing.numbers = [phoneNumber];
        existing.allowedAddresses = allowedAddresses;
        const updated = await sip.updateSipInboundTrunk(existing.sipTrunkId, existing);
        console.log(`[setup-livekit-inbound] Updated inbound trunk ${updated.sipTrunkId} for ${phoneNumber}`);
        return updated.sipTrunkId;
    }
    const created = await sip.createSipInboundTrunk(TRUNK_NAME, [phoneNumber], { allowedAddresses });
    console.log(`[setup-livekit-inbound] Created inbound trunk ${created.sipTrunkId} for ${phoneNumber}`);
    return created.sipTrunkId;
}

/**
 * Creates or updates the `callback-` individual-room dispatch rule and returns its id.
 *
 * @param sip - LiveKit SIP client
 * @param trunkIds - Trunks the rule applies to; empty means every inbound trunk and number
 */
async function upsertDispatchRule(sip: SipClient, trunkIds: string[]): Promise<string> {
    const existing = (await sip.listSipDispatchRule()).find((rule) => rule.name === RULE_NAME);
    const kind = existing?.rule?.rule;
    const sameShape = kind?.case === "dispatchRuleIndividual" && kind.value.roomPrefix === CALLBACK_ROOM_PREFIX;
    if (existing && sameShape) {
        existing.trunkIds = trunkIds;
        const updated = await sip.updateSipDispatchRule(existing.sipDispatchRuleId, existing);
        console.log(`[setup-livekit-inbound] Updated dispatch rule ${updated.sipDispatchRuleId}`);
        return updated.sipDispatchRuleId;
    }
    if (existing) {
        await sip.deleteSipDispatchRule(existing.sipDispatchRuleId);
        console.log(`[setup-livekit-inbound] Replaced dispatch rule ${existing.sipDispatchRuleId} (different shape)`);
    }
    const created = await sip.createSipDispatchRule(
        { type: "individual", roomPrefix: CALLBACK_ROOM_PREFIX },
        { name: RULE_NAME, trunkIds },
    );
    console.log(`[setup-livekit-inbound] Created dispatch rule ${created.sipDispatchRuleId}`);
    return created.sipDispatchRuleId;
}

/**
 * Creates or updates the inbound trunk (when Twilio is configured) and the dispatch rule.
 */
async function main(): Promise<void> {
    const host = requireEnv("LIVEKIT_URL").replace(/^ws/, "http");
    const sip = new SipClient(host, requireEnv("LIVEKIT_API_KEY"), requireEnv("LIVEKIT_API_SECRET"));
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
    const allNumbers = process.argv.includes("--all-numbers");

    let trunkId: string | null = null;
    if (phoneNumber) {
        if (!E164_PATTERN.test(phoneNumber)) {
            console.error(`[setup-livekit-inbound] TWILIO_PHONE_NUMBER must be E.164 like +15555550100`);
            process.exit(1);
        }
        trunkId = await upsertInboundTrunk(sip, phoneNumber, envList("LIVEKIT_SIP_INBOUND_ALLOWED_ADDRESSES"));
    } else {
        console.warn("[setup-livekit-inbound] TWILIO_PHONE_NUMBER is not set; skipping the Twilio inbound trunk.");
    }

    const ruleTrunkIds = trunkId && !allNumbers ? [trunkId] : [];
    const ruleId = await upsertDispatchRule(sip, ruleTrunkIds);

    console.log("\nInbound callbacks:");
    console.log(`  inbound trunk:  ${trunkId ?? "(none)"}`);
    console.log(`  dispatch rule:  ${ruleId} (individual rooms, prefix "${CALLBACK_ROOM_PREFIX}", `
        + `${ruleTrunkIds.length ? `trunk ${ruleTrunkIds[0]}` : "all inbound trunks and numbers"})`);
    if (trunkId) {
        console.log(`\nAdd to .env (and Doppler):\nLIVEKIT_SIP_INBOUND_TRUNK_ID=${trunkId}`);
    }
    console.log(`LIVEKIT_SIP_DISPATCH_RULE_ID=${ruleId}`);
}

main().catch((error: unknown) => {
    console.error(`[setup-livekit-inbound] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
