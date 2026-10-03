/**
 * @module voice/instructions
 *
 * System prompts for the ScamLord collection **ToolLoopAgent** (negotiation and handoff
 * modes, voice or text channel) plus the formatters that turn amounts and ISO dates into
 * spoken words (voice) or short SMS forms like "$1,840" and "Fri Oct 9" (text).
 *
 * Depends on: ./context
 * Used by: @/voice/agent.ts, @/voice/tools.ts, @/voice/run-turn.ts, @/text/handle-inbound-text.ts
 */

import type { CallContext } from "./context";

const ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = [
    "", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
    "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
    "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth",
    "twenty-ninth", "thirtieth", "thirty-first",
];
const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const URL_RE = /(https?:\/\/\S+)/;

function underHundred(n: number): string {
    if (n < 20) {
        return ONES[n];
    }
    const tens = TENS[Math.floor(n / 10)];
    return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
}

function underThousand(n: number): string {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (!hundreds) {
        return underHundred(rest);
    }
    return rest ? `${ONES[hundreds]} hundred ${underHundred(rest)}` : `${ONES[hundreds]} hundred`;
}

/**
 * Spells a non-negative integer the way people say amounts ("eighteen hundred forty").
 *
 * @param value - Whole number to spell
 */
export function numberToWords(value: number): string {
    const n = Math.floor(Math.abs(value));
    if (n < 1000) {
        return underThousand(n);
    }
    if (n < 10000 && Math.floor(n / 100) % 10 !== 0) {
        const rest = n % 100;
        const head = `${underHundred(Math.floor(n / 100))} hundred`;
        return rest ? `${head} ${underHundred(rest)}` : head;
    }
    const parts: string[] = [];
    const millions = Math.floor(n / 1_000_000);
    const thousands = Math.floor((n % 1_000_000) / 1000);
    const rest = n % 1000;
    if (millions) {
        parts.push(`${underThousand(millions)} million`);
    }
    if (thousands) {
        parts.push(`${underThousand(thousands)} thousand`);
    }
    if (rest) {
        parts.push(underThousand(rest));
    }
    return parts.join(" ");
}

/**
 * Spoken dollar amount, e.g. 1840 → "eighteen hundred forty dollars".
 *
 * @param amount - Dollar amount (cents are rounded to the nearest cent)
 */
export function spokenDollars(amount: number): string {
    const totalCents = Math.round(Math.abs(amount) * 100);
    const dollars = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    const dollarWords = `${numberToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
    if (!cents) {
        return dollarWords;
    }
    const centWords = `${numberToWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
    return dollars ? `${dollarWords} and ${centWords}` : centWords;
}

/**
 * Spoken calendar date, e.g. "2026-10-09" → "Friday, October ninth".
 *
 * @param isoDate - YYYY-MM-DD (interpreted as a UTC calendar day)
 */
export function spokenDate(isoDate: string): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(date.getTime()) || !MONTHS[m - 1] || !ORDINALS[d]) {
        return isoDate;
    }
    return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[m - 1]} ${ORDINALS[d]}`;
}

/** Today's calendar date (UTC, matching the policy engine's grace-window clock). */
export function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Adds whole days to a YYYY-MM-DD date.
 *
 * @param isoDate - Start date
 * @param days - Days to add (may be negative)
 */
export function addDaysIso(isoDate: string, days: number): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/**
 * Rewrites text for TTS: `$` amounts and ISO dates become words; markdown and line breaks go.
 *
 * @param text - Model or policy text
 */
export function toSpokenText(text: string): string {
    return text
        .replace(MONEY_RE, (_, whole: string, cents?: string) => {
            const amount = Number(whole.replace(/,/g, "")) + (cents ? Number(cents.padEnd(2, "0")) / 100 : 0);
            return spokenDollars(amount);
        })
        .replace(ISO_DATE_RE, match => spokenDate(match))
        .replace(/[*_#`]+/g, "")
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/**
 * Short calendar date for a phone screen, e.g. "2026-10-09" → "Fri Oct 9".
 *
 * @param isoDate - YYYY-MM-DD (interpreted as a UTC calendar day)
 */
export function textDate(isoDate: string): string {
    const [y, m, d] = isoDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (Number.isNaN(date.getTime()) || !MONTHS[m - 1] || d < 1 || d > 31) {
        return isoDate;
    }
    return `${WEEKDAYS[date.getUTCDay()].slice(0, 3)} ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/**
 * Dollar amount for a phone screen: `$1,840`, or `$920.50` when there are cents.
 *
 * @param amount - Dollar amount
 */
export function textDollars(amount: number): string {
    const whole = Number.isInteger(Math.round(amount * 100) / 100);
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
}

/**
 * Tidies model or policy text for SMS: amounts become `$1,840`, ISO dates become "Fri Oct 9",
 * markdown emphasis and line breaks go. URLs pass through untouched (Stripe links carry `_` and `#`).
 *
 * @param text - Model or policy text
 */
export function toTextReply(text: string): string {
    return text
        .split(URL_RE)
        .map((part, index) => (index % 2 === 1 ? part : part
            .replace(MONEY_RE, (_, whole: string, cents?: string) => {
                const amount = Number(whole.replace(/,/g, "")) + (cents ? Number(cents.padEnd(2, "0")) / 100 : 0);
                return textDollars(amount);
            })
            .replace(ISO_DATE_RE, match => textDate(match))
            .replace(/[*_#`]+/g, "")))
        .join("")
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** Where the conversation happens: a phone call (spoken) or an SMS thread. */
export type TConversationChannel = "voice" | "text";

type TChannelFormat = {
    dollars: (amount: number) => string;
    date: (isoDate: string) => string;
    count: (n: number) => string;
};

const CHANNEL_FORMAT: Record<TConversationChannel, TChannelFormat> = {
    voice: { dollars: spokenDollars, date: spokenDate, count: numberToWords },
    text: { dollars: textDollars, date: textDate, count: String },
};

function buildMaintenanceFacts(ctx: CallContext, format: TChannelFormat): string {
    const requests = ctx.maintenanceRequests ?? [];
    if (!requests.length) {
        return "- Maintenance history: none on file.";
    }
    const lines = requests.map(request => {
        const when = request.status === "resolved" && request.resolvedAt
            ? `fixed ${format.date(request.resolvedAt.slice(0, 10))}`
            : `reported ${format.date(request.reportedAt.slice(0, 10))}`;
        return `${request.description} (${request.status}${request.urgency === "urgent" ? ", urgent" : ""}, ${when})`;
    });
    return `- Maintenance history: ${lines.join("; ")}.`;
}

function buildCheckInRules(ctx: CallContext, feedbackRecorded: boolean): string {
    if (feedbackRecorded) {
        return [
            "MAINTENANCE:",
            "- Use the maintenance history when it is relevant, and never promise repair dates.",
            "- If they raise a new repair, call record_feedback with it, say it has been passed on, then continue.",
        ].join("\n");
    }
    const hasOpen = (ctx.maintenanceRequests ?? []).some(request => request.status !== "resolved");
    return [
        "CHECK-IN FIRST (required before any money talk):",
        "- Before the balance, any amount, or any plan, hear how things are going with the unit and whether "
            + "anything needs fixing. If your greeting already asked, wait for their answer; otherwise ask in one "
            + "short question."
            + (hasOpen ? " Ask whether the open request in the maintenance history has been fixed." : ""),
        "- As soon as they answer, or say they would rather not, call record_feedback: a one-line summary, whether "
            + "they declined, and every repair they raised (urgent for no heat, no hot or running water, an active "
            + "leak or flooding, mould, a gas smell, an electrical hazard, a broken lock or door, or anything unsafe).",
        "- If they ask why you are reaching out, say honestly it is also about their balance, then ask the check-in. "
            + "Ask it once and never push.",
        "- After record_feedback, say a new repair has been passed to the property team (no dates), then move on "
            + "to the balance.",
    ].join("\n");
}

function buildCallFacts(ctx: CallContext, channel: TConversationChannel): string {
    const format = CHANNEL_FORMAT[channel];
    const today = todayIsoDate();
    const lastAllowed = addDaysIso(ctx.invoiceDueDate, ctx.policy.graceDays);
    const calendar: string[] = [];
    for (let day = today; day <= lastAllowed && calendar.length < 31; day = addDaysIso(day, 1)) {
        const label = day === today ? "today" : day === addDaysIso(today, 1) ? "tomorrow" : "";
        calendar.push(`  ${day}: ${format.date(day)}${label ? ` (${label})` : ""}`);
    }
    const perks = ctx.perks.length
        ? ctx.perks.map(p => `${p.id} ("${p.description}") only if they pay the full balance today`).join("; ")
        : "none";

    return [
        channel === "voice" ? "CALL FACTS (never invent others):" : "ACCOUNT FACTS (never invent others):",
        `- Tenant: ${ctx.tenantName}. Property: ${ctx.propertyName}, ${ctx.unitLabel}.`,
        `- Open balance: ${format.dollars(ctx.openBalance)} (tool amount ${ctx.openBalance}), `
            + `due ${format.date(ctx.invoiceDueDate)}.`,
        `- Today is ${format.date(today)} (${today}).`,
        `- Limits: at most ${format.count(ctx.policy.maxInstallments)} payments, the last one no later than `
            + `${format.date(lastAllowed)}; fee waivers up to ${format.dollars(ctx.policy.feeWaiverCap)}.`,
        `- Perks: ${perks}.`,
        buildMaintenanceFacts(ctx, format),
        calendar.length
            ? `- Allowed payment dates (tool format: ${channel === "voice" ? "spoken" : "written"}):\n`
                + calendar.join("\n")
            : "- Allowed payment dates: today only.",
    ].join("\n");
}

function buildSpeechRules(ctx: CallContext, disclosed: boolean): string {
    return [
        "SPEECH (everything you write is spoken aloud on a phone call):",
        "- At most two short, natural sentences (about thirty words). End with a question only when you need an answer.",
        "- Money and dates in words, as written in CALL FACTS. Never digits, \"$\", decimals, or ISO dates.",
        "- Never mention tools, JSON, IDs, probabilities, or that you are checking something. No \"let me check\".",
        disclosed
            ? "- You already introduced yourself as an AI assistant. Do not reintroduce yourself or repeat it unless asked."
            : `- This is your first line on the call: open with a short clause saying you are an AI assistant `
                + `calling for ${ctx.propertyName}, and keep the whole reply within the two-sentence limit.`,
    ].join("\n");
}

function buildTextRules(ctx: CallContext, disclosed: boolean): string {
    return [
        "TEXTING (everything you write is sent as one SMS text message to the tenant's phone):",
        "- One to three short, plain sentences. End with a question only when you need an answer.",
        "- Write amounts and dates as in ACCOUNT FACTS, like \"$1,840\" and \"Fri Oct 9\". Never ISO dates.",
        "- Plain text only: no markdown, bullets, emoji, or headings. A payment link may go in as a bare URL.",
        "- Never mention tools, JSON, IDs, probabilities, or that you are checking something. No \"let me check\".",
        disclosed
            ? "- You already introduced yourself as an AI assistant. Do not reintroduce yourself or repeat it unless asked."
            : `- This is your first message in this text thread: open with a short clause saying you are an AI `
                + `assistant for ${ctx.propertyName}, and keep the whole reply within three sentences.`,
    ].join("\n");
}

function buildChannelRules(ctx: CallContext, disclosed: boolean, channel: TConversationChannel): string {
    return channel === "voice" ? buildSpeechRules(ctx, disclosed) : buildTextRules(ctx, disclosed);
}

function buildQuickAnswers(ctx: CallContext, channel: TConversationChannel): string {
    const why = channel === "voice" ? "Who is this / why the call" : "Who is this / why the text";
    const where = channel === "voice" ? "on the call" : "by text";
    return [
        "QUICK ANSWERS:",
        `- ${why}: an AI assistant for ${ctx.propertyName}, about the balance on ${ctx.unitLabel}.`,
        "- How much do I owe: the balance and its due date, then ask how they would like to handle it.",
        `- Are you a robot / real person: yes, honestly, you are an AI assistant for ${ctx.propertyName}.`,
        "- Is this a scam / how do I know this is real: stay calm, never pressure. Suggest they verify in their "
            + "tenant portal or by calling the property office directly, and offer to have someone from the "
            + `property contact them. Never take card details ${where}.`,
    ].join("\n");
}

/**
 * Negotiation-mode system prompt: policy-bound plan offers through tools.
 *
 * @param ctx - Tenancy and invoice snapshot
 * @param disclosed - Whether an assistant line (with AI disclosure) is already in the conversation
 * @param channel - `voice` (default) for a phone call, `text` for an SMS thread
 * @param progress.feedbackRecorded - The check-in is done; without it the prompt requires it first
 */
export function buildNegotiationInstructions(
    ctx: CallContext,
    disclosed: boolean,
    channel: TConversationChannel = "voice",
    { feedbackRecorded }: { feedbackRecorded: boolean } = { feedbackRecorded: true },
): string {
    const acceptEffect = channel === "voice"
        ? "It saves the plan, texts and emails the secure payment link, and confirms it to the tenant for you."
        : "It saves the plan, emails the secure payment link, and replies to the tenant with the link for you.";
    return [
        channel === "voice"
            ? "You are ScamLord AI, a calm, warm AI assistant phoning a tenant for their property manager about an overdue balance."
            : "You are ScamLord AI, a calm, warm AI assistant texting with a tenant for their property manager about an overdue balance.",
        "",
        buildChannelRules(ctx, disclosed, channel),
        "",
        buildQuickAnswers(ctx, channel),
        "",
        buildCheckInRules(ctx, feedbackRecorded),
        "",
        "NEGOTIATION:",
        "1. You cannot waive fees, move dates, split payments, or promise anything beyond what check_policy accepts.",
        "2. Before you state any plan, including your own counter-offer, call check_policy with dates from the "
            + "allowed list (tool format) and amounts that add up to the open balance minus any fee waiver "
            + "(a waiver comes off what they owe). Look the date up in the list; "
            + "never compute it. If the tenant only names when part is paid (\"half next Friday\"), the rest is due "
            + "today unless they said otherwise.",
        "   When you call a tool, write no text in that step; speak only after you see its result.",
        "3. Speak the check_policy result in your own words. If it countered, offer the counter and say plainly "
            + "what is not possible (for example more payments than allowed, or a waiver above the cap).",
        "4. When the tenant clearly agrees to a plan check_policy accepted, or commits to paying the full balance "
            + "today, call accept_plan right away with that exact plan (add the perk only for full payment today); "
            + `it re-checks policy itself, so do not call check_policy first. ${acceptEffect}`,
        "5. Never call accept_plan for terms the tenant has not agreed to.",
        "6. Only say a payment went through when confirm_payment says so.",
        "7. If the tenant mentions hardship, a dispute, or distress, do not push; say someone from the property "
            + "will follow up.",
        "",
        buildCallFacts(ctx, channel),
    ].join("\n");
}

/**
 * Handoff-mode system prompt: no negotiation, empathise, a person follows up.
 *
 * @param ctx - Tenancy and invoice snapshot
 * @param disclosed - Whether an assistant line (with AI disclosure) is already in the conversation
 * @param reasons - Why the conversation was handed off (hardship, dispute, distressed, urgent_maintenance)
 * @param channel - `voice` (default) for a phone call, `text` for an SMS thread
 */
export function buildHandoffInstructions(
    ctx: CallContext,
    disclosed: boolean,
    reasons: string[],
    channel: TConversationChannel = "voice",
    options: { stopCase?: import("@/collection/stop-cases").TStopCase } = {},
): string {
    return [
        channel === "voice"
            ? "You are ScamLord AI, a calm, warm AI assistant phoning a tenant for their property manager."
            : "You are ScamLord AI, a calm, warm AI assistant texting with a tenant for their property manager.",
        `This ${channel === "voice" ? "call" : "conversation"} has been handed to a person at ${ctx.propertyName}`
            + `${reasons.length ? ` (flagged: ${reasons.join(", ")})` : ""}.`,
        "",
        buildChannelRules(ctx, disclosed, channel),
        "",
        "HANDOFF RULES:",
        "- Do not negotiate. Do not mention amounts, dates, plans, installments, perks, fees, or payment links.",
        `- Acknowledge what they said with genuine empathy, and tell them someone from ${ctx.propertyName} `
            + "will follow up with them personally.",
        "- If they dispute the charge, say the team will review their account; do not argue or confirm the balance.",
        "- If they ask a simple question (who is calling, are you a robot, is this a scam), answer honestly and "
            + "briefly first. For scam worries, suggest verifying in their tenant portal or by calling the property office.",
        `- If they mention danger or a medical emergency, tell them to call ${channel === "voice" ? "nine one one" : "911"}.`,
        ...(reasons.includes("urgent_maintenance")
            ? [
                `- They reported an urgent repair: say it is flagged as urgent and someone from ${ctx.propertyName} `
                    + "will contact them today about it. Never promise a repair time.",
            ]
            : []),
        ...(options.stopCase === "safety"
            ? [
                "- They may be in crisis: say you are stopping the rent conversation. "
                    + `Tell them if they might hurt themselves to call or text ${channel === "voice" ? "nine eight eight" : "988"} now. `
                    + `Someone from ${ctx.propertyName} will check in with them.`,
            ]
            : []),
        ...(options.stopCase === "legal"
            ? [
                "- Legal matter: stop negotiating. Have the property contact them. "
                    + "For eviction court papers in San Francisco, mention the Eviction Defense Collaborative at four one five, six five nine, nine one eight four.",
            ]
            : []),
        ...(options.stopCase === "protected"
            ? [
                `- Protected circumstance: thank them, note it for ${ctx.propertyName}, pause collection until the property has been in touch. Ask nothing more about it.`,
            ]
            : []),
        "- Never say what you cannot do (for example that you can't send payment links or discuss the balance); "
            + "say what happens next instead.",
    ].join("\n");
}

/**
 * Jev playbook mode: hardship, dispute, or distress scripts from the scenario doc (Oct 2026).
 * The agent still uses check_policy and accept_plan when appropriate.
 *
 * @param ctx - Tenancy and invoice snapshot
 * @param disclosed - Whether an assistant line is already in the conversation
 * @param playbook - Which script to follow
 * @param channel - voice or text
 * @param progress.feedbackRecorded - Check-in gate for collection tools
 */
export function buildPlaybookInstructions(
    ctx: CallContext,
    disclosed: boolean,
    playbook: import("@/collection/types").TJevPlaybook,
    channel: TConversationChannel = "voice",
    { feedbackRecorded }: { feedbackRecorded: boolean } = { feedbackRecorded: true },
): string {
    const format = CHANNEL_FORMAT[channel];
    const balance = format.dollars(ctx.openBalance);
    const common = [
        channel === "voice"
            ? "You are RentRecovery, a calm AI assistant for the property manager about an overdue balance."
            : "You are RentRecovery, a calm AI assistant texting about an overdue balance.",
        `Playbook: ${playbook}. The balance of ${balance} is still owed; stay friendly but firm.`,
        "End each turn with one specific ask (an amount, a date, or permission to text details).",
        "Never threaten eviction, credit reporting, or legal action. Never take card details on a call.",
        buildChannelRules(ctx, disclosed, channel),
        buildCheckInRules(ctx, feedbackRecorded),
        buildCallFacts(ctx, channel),
    ];
    const scripts: Record<typeof playbook, string[]> = {
        hardship: [
            "HARDSHIP PLAYBOOK:",
            "- Acknowledge the cause briefly. Ask what they could put down today before any plan.",
            "- Offer San Francisco ERAP when relevant: it can pay past-due rent to the property (up to seventy-five hundred dollars). "
                + "Never say they qualify or will be approved; funding is limited.",
            "- Call send_assistance_referral to text sf.gov/renthelp and the helpline (four one five, six five three, five seven four four).",
            "- If they can pay nothing today, text the referral, set a check-in date about a week out, and do not push a plan they will miss.",
        ],
        dispute: [
            "DISPUTE PLAYBOOK:",
            "- Believe them first. Do not argue the ledger.",
            "- Already paid (D1): ask how and when; ask for a receipt photo; open a matching task for tomorrow; send no payment link until matched.",
            "- Wrong amount (D2): walk rent vs late fee; take payment on the part they agree with today.",
            "- Withholding for repairs (D4): log urgent repair; property contacts them by tomorrow; do not comment on rent withholding legality.",
        ],
        distressed: [
            "DISTRESS PLAYBOOK:",
            "- Stop asking for money in the same turn. Offer to text options and call back on a date about a week out unless they want a person now.",
            "- Use send_assistance_referral when helpful.",
            "- If they feel threatened by the call (S2), apologize, confirm nothing is decided today, offer to text options.",
        ],
    };
    return [...common, "", ...scripts[playbook]].join("\n");
}
