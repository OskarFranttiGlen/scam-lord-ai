/**
 * @module voice/agent
 *
 * Factory for the collection **ToolLoopAgent** (one turn per generate), shared by phone calls
 * and the SMS thread. Each call picks negotiation or handoff mode from `state.handoffActive`
 * and skips the AI disclosure once an assistant line is already in the conversation. The
 * `channel` option picks spoken (voice, default) or phone-screen (text) wording.
 *
 * Depends on: ai, ./instructions, ./tools, ./context
 * Used by: @/voice/run-turn.ts, @/voice/worker.ts, /api/voice/turn, @/text/handle-inbound-text.ts
 */

import { ToolLoopAgent, gateway, isStepCount, type LanguageModel, type ModelMessage } from "ai";

import type { TJevPolicyConstraints } from "@/collection/types";
import {
    buildHandoffInstructions,
    buildNegotiationInstructions,
    buildPlaybookInstructions,
    toSpokenText,
    toTextReply,
    type TConversationChannel,
} from "./instructions";
import { getCollectionTools, type TSignalGate } from "./tools";
import type { CallContext, CallState } from "./context";

export type { TConversationChannel } from "./instructions";

/** Gateway model for the voice brain; `SCAMLORD_VOICE_MODEL` overrides it. */
export const VOICE_BRAIN_MODEL = process.env.SCAMLORD_VOICE_MODEL?.trim() || "anthropic/claude-haiku-4.5";

export type TCreateCollectionVoiceAgentProps = {
    context: CallContext;
    state: CallState;
    onStateChange?: (state: CallState) => void;
    /** `voice` (default) speaks on a call; `text` writes SMS replies. */
    channel?: TConversationChannel;
    /** Brain override for tests; defaults to the gateway voice model. */
    model?: LanguageModel;
};

/**
 * True when the conversation already contains a spoken assistant line (which carried the disclosure).
 *
 * @param messages - Model messages sent to this generate call
 */
export function hasAssistantLine(messages: ModelMessage[] | undefined): boolean {
    return (messages ?? []).some(message => message.role === "assistant");
}

type TCollectionCallSettings = {
    instructions: string;
    activeTools?: Array<"record_feedback" | "end_call">;
    toolChoice?: "auto" | "none";
};

/**
 * Per-call prompt and tool access: handoff, playbook, or negotiation. A handed-off agent may
 * still log the check-in, so a repair raised on the same turn as a handoff is not lost.
 *
 * @param context - Tenancy and invoice snapshot
 * @param state - Call state for this turn
 * @param options.disclosed - An assistant line is already in the conversation
 * @param options.channel - `voice` or `text`
 */
export function collectionCallSettings(
    context: CallContext,
    state: CallState,
    { disclosed, channel }: { disclosed: boolean; channel: TConversationChannel },
): TCollectionCallSettings {
    if (state.handoffActive) {
        const reasons: string[] = state.urgentMaintenance
            ? ["urgent_maintenance"]
            : state.jevChecks.at(-1)?.outcome.reasons ?? [];
        const handoff = buildHandoffInstructions(context, disclosed, reasons, channel, { stopCase: state.stopCase });
        if (state.feedbackRecorded) {
            return { instructions: handoff, activeTools: ["end_call"], toolChoice: "auto" };
        }
        return {
            instructions: `${handoff}\n- If they mentioned a repair or how the unit is going, call record_feedback with it `
                + "(urgent for leaks, no heat, no water, gas, electrical, or safety issues) before you reply.",
            activeTools: ["record_feedback", "end_call"],
            toolChoice: "auto",
        };
    }
    if (state.jevPlaybook) {
        return {
            instructions: buildPlaybookInstructions(context, disclosed, state.jevPlaybook, channel, {
                feedbackRecorded: state.feedbackRecorded,
            }),
        };
    }
    return {
        instructions: buildNegotiationInstructions(context, disclosed, channel, {
            feedbackRecorded: state.feedbackRecorded,
        }),
    };
}

/**
 * Tools whose result `say` line is the whole spoken reply for the turn. When one of them
 * returns, the loop stops and run-turn speaks the `say` directly, skipping the second
 * model pass that re-phrases it. Guidance-only tools (record_feedback, create_office_task,
 * end_call, record_closing_feedback) stay out on purpose: the model must still produce the
 * reply around them.
 */
const SPEAKABLE_TOOLS = new Set(["accept_plan", "check_policy", "confirm_payment", "send_assistance_referral"]);

/** Loop-step slice the stop condition reads; keeps the SDK's generic step types at arm's length. */
type TToolSayStep = {
    toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
};

/**
 * Stops the tool loop once a speakable tool returned a `say` line (see {@link SPEAKABLE_TOOLS}).
 * Results without a spoken `say` line — `next`-only guidance, or a failed call — keep the loop
 * going so the model can phrase the reply itself.
 *
 * @param options.steps - Completed loop steps, newest last
 */
function spokeToolSay({ steps }: { steps: readonly TToolSayStep[] }): boolean {
    const last = steps.at(-1);
    return last?.toolResults.some(({ toolName, output }) => (
        SPEAKABLE_TOOLS.has(toolName)
        && output != null
        && typeof output === "object"
        && "say" in output
        && typeof output.say === "string"
    )) ?? false;
}

/**
 * Creates a ToolLoopAgent configured for ScamLord collection turns.
 *
 * @param props.context - Tenancy and invoice snapshot
 * @param props.state - Mutable call state shared with tools
 * @param props.onStateChange - Optional hook when tools mutate state
 * @param props.channel - `voice` (default) or `text`
 * @param props.model - Optional brain override for tests
 */
export function createCollectionVoiceAgent({
    context,
    state,
    onStateChange,
    channel = "voice",
    model = gateway(VOICE_BRAIN_MODEL),
}: TCreateCollectionVoiceAgentProps) {
    const signalGate: TSignalGate = { pending: null };
    const tools = getCollectionTools(context, state, { onStateChange, signalGate, channel });

    const agent = new ToolLoopAgent({
        model,
        instructions: buildNegotiationInstructions(context, false, channel),
        tools,
        stopWhen: [isStepCount(4), spokeToolSay],
        maxOutputTokens: 300,
        temperature: 0.3,
        prepareCall: ({ messages, prompt, ...rest }) => {
            const disclosed = hasAssistantLine(messages ?? (Array.isArray(prompt) ? prompt : undefined));
            const base = messages ? { ...rest, messages } : { ...rest, prompt: prompt ?? "" };
            return { ...base, ...collectionCallSettings(context, state, { disclosed, channel }) };
        },
    });

    const signalConstraints: TJevPolicyConstraints = {
        max_installments: context.policy.maxInstallments,
        grace_days: context.policy.graceDays,
        fee_waiver_cap: context.policy.feeWaiverCap,
    };

    const requests = context.maintenanceRequests ?? [];
    const signalMaintenanceSummary = requests.length
        ? requests.map(request => `${request.description}: ${request.status}, reported ${request.reportedAt.slice(0, 10)}`)
            .join("\n")
        : null;

    return Object.assign(agent, {
        channel,
        signalGate,
        signalConstraints,
        /** Repair history passed to Jev with each transcript. */
        signalMaintenanceSummary,
        disclosureLine: channel === "voice"
            ? `Hi, I'm an AI assistant calling for ${context.propertyName}.`
            : `Hi, this is an AI assistant for ${context.propertyName}.`,
        /** Final reply formatter: spoken words on voice, SMS-safe text on text. */
        formatReply: channel === "voice" ? toSpokenText : toTextReply,
    });
}

export type TCollectionVoiceAgent = ReturnType<typeof createCollectionVoiceAgent>;
