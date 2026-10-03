/**
 * @module messaging/sms
 *
 * Sends one SMS through the Twilio Programmable Messaging REST API (plain `fetch`, no SDK).
 *
 * Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164 sender).
 *
 * Depends on: global fetch
 * Used by: @/messaging/send-payment-link.ts
 */

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export type TSmsInput = {
    /** Recipient in E.164, e.g. `+15555550102`. */
    to: string;
    body: string;
};

export type TSmsResult = {
    /** Twilio message SID (`SM…`), stored on the call row. */
    sid: string;
};

type TTwilioConfig = {
    accountSid: string;
    authToken: string;
    fromNumber: string;
};

/**
 * Reads Twilio credentials from env, throwing a message that names every missing key.
 */
function readTwilioConfig(): TTwilioConfig {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
    if (!accountSid || !authToken || !fromNumber) {
        const missing = [
            !accountSid && "TWILIO_ACCOUNT_SID",
            !authToken && "TWILIO_AUTH_TOKEN",
            !fromNumber && "TWILIO_PHONE_NUMBER",
        ].filter(Boolean);
        throw new Error(`Twilio SMS is not configured: missing ${missing.join(", ")}`);
    }
    return { accountSid, authToken, fromNumber };
}

/**
 * Sends an SMS via Twilio. Throws on missing config or a non-2xx response.
 *
 * @param input - Recipient and message body
 */
export async function sendSms(input: TSmsInput): Promise<TSmsResult> {
    const { accountSid, authToken, fromNumber } = readTwilioConfig();
    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
            authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: input.to, From: fromNumber, Body: input.body }).toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!response.ok || !payload.sid) {
        const detail = payload.message ?? "no error message";
        const code = payload.code === undefined ? "" : ` (code ${payload.code})`;
        throw new Error(`Twilio SMS failed with HTTP ${response.status}${code}: ${detail}`);
    }
    return { sid: payload.sid };
}
