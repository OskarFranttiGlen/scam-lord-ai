/**
 * @module artifact-builder/utils/mutation-proposal
 *
 * Collect / Accept / Reject / empty-land for mutateArtifact tool parts (ADR 0034 / 05).
 * Ordinary tool errors only — Soft-fail and buildProgram paths are gone.
 *
 * Depends on: mutations/apply, mutations/applyProposal, mutations/schemas
 * Used by: MessageBubbles, Dashboard lock helpers
 */

import { toast } from "sonner";

import {
    applyArtifactProposal,
    applyOperations,
    isApplyBatchFailure,
} from "@/components/artifact-builder/mutations";
import type { TArtifactOperation } from "@/components/artifact-builder/mutations/schemas";

export type TChatStatusForProposal = "streaming" | "ready" | (string & {});

export type TMutationProposalDecision = "accepted" | "pending" | "rejected";

/**
 * Structural chat message used by proposal collect/land.
 * `TChatMessage` / UIMessage satisfy this without casts in tests.
 */
export type TProposalThreadMessage = {
    id: string;
    role: string;
    metadata?: unknown;
    parts?: ReadonlyArray<{
        type: string;
        output?: unknown;
    }>;
};

export interface IMutationProposal {
    keys: string[];
    messageIds: string[];
    operations: TArtifactOperation[];
}

/** Simple recipe lines for the Accept/Reject card (domain-neutral). */
export type TMutationProposalRecipe = {
    lines: string[];
};

type TMutateArtifactOutput = {
    operations?: TArtifactOperation[];
    error?: string;
};

function isMetadataRecord(metadata: unknown): metadata is Record<string, unknown> {
    return metadata != null && typeof metadata === "object" && !Array.isArray(metadata);
}

function summarizeOperation(operation: TArtifactOperation): string {
    switch (operation.op) {
        case "set_title":
            return `Set title to "${operation.title}"`;
        case "add_week":
            return operation.atIndex == null
                ? "Add week"
                : `Add week at index ${operation.atIndex}`;
        case "delete_week":
            return `Delete week ${operation.weekIndex}`;
        case "add_day":
            return `Add day${operation.title ? ` "${operation.title}"` : ""} (week ${operation.weekIndex})`;
        case "delete_day":
            return `Delete day ${operation.dayId} (week ${operation.weekIndex})`;
        case "rename_day":
            return `Rename day ${operation.dayId} to "${operation.title}"`;
        case "upsert_item":
            return `Upsert item "${operation.item.title}" (week ${operation.weekIndex})`;
        case "delete_item":
            return `Delete item ${operation.itemId} (week ${operation.weekIndex})`;
        case "reorder_items":
            return `Reorder items on day ${operation.dayId} (week ${operation.weekIndex})`;
        default: {
            const _exhaustive: never = operation;
            return String((_exhaustive as TArtifactOperation).op);
        }
    }
}

/**
 * Recipe lines for a Mutation proposal card.
 *
 * @param operations - Pending fail-all batch
 */
export function buildMutationProposalRecipe(
    operations: readonly TArtifactOperation[] | undefined,
): TMutationProposalRecipe {
    if (!operations?.length) {
        return { lines: [] };
    }
    return { lines: operations.map(summarizeOperation) };
}

function readStoredMutationProposalDecision(
    message: TProposalThreadMessage,
): TMutationProposalDecision | undefined {
    if (!isMetadataRecord(message.metadata)) return undefined;
    const stored = message.metadata.mutationProposal;
    if (stored === "accepted" || stored === "pending" || stored === "rejected") {
        return stored;
    }
    return undefined;
}

/**
 * Recipe frozen at Accept / Reject.
 *
 * @param message - Assistant message that may hold a stored recipe
 */
export function readStoredMutationProposalRecipe(
    message: TProposalThreadMessage,
): TMutationProposalRecipe | null {
    if (!isMetadataRecord(message.metadata)) return null;
    const stored = message.metadata.mutationProposalRecipe;
    if (stored == null || typeof stored !== "object" || Array.isArray(stored)) {
        return null;
    }
    const lines = (stored as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return null;
    return { lines: lines.filter((line): line is string => typeof line === "string") };
}

/**
 * Decision for a Mutation proposal card: stored metadata wins; a later user
 * message is an implicit Reject.
 *
 * @param message - Assistant message that may hold mutateArtifact parts
 * @param laterMessages - Messages after this one
 */
export function resolveMutationProposalDecision(
    message: TProposalThreadMessage,
    laterMessages: readonly TProposalThreadMessage[],
): TMutationProposalDecision | null {
    const stored = readStoredMutationProposalDecision(message);
    if (stored === "accepted" || stored === "rejected") {
        return stored;
    }
    if (laterMessages.some((candidate) => candidate.role === "user")) {
        return "rejected";
    }
    if (stored === "pending") {
        return "pending";
    }
    return null;
}

/**
 * Write Accept/Reject decision (+ optional frozen recipe) onto message metadata.
 *
 * @param messages - Chat thread
 * @param messageIds - Assistant message ids that owned the proposal
 * @param decision - accepted or rejected
 * @param recipe - Frozen recipe for the card after decide
 */
export function withMutationProposalDecision(
    messages: TChatMessage[],
    messageIds: string[],
    decision: Exclude<TMutationProposalDecision, "pending">,
    recipe?: TMutationProposalRecipe,
): TChatMessage[] {
    const idSet = new Set(messageIds);
    return messages.map((message) => {
        if (!idSet.has(message.id)) return message;
        const prev = isMetadataRecord(message.metadata) ? message.metadata : {};
        return {
            ...message,
            metadata: {
                ...prev,
                mutationProposal: decision,
                ...(recipe ? { mutationProposalRecipe: recipe } : {}),
            },
        };
    });
}

/**
 * Collects a standalone Mutation proposal from mutateArtifact tool parts.
 * Empty artifacts use {@link tryLandEmptyArtifactMutations} instead.
 *
 * @param messages - Chat thread
 * @param status - Stream status; streaming never opens a proposal
 * @param document - Live Chat artifact; empty (no weeks) has no standalone proposal
 * @param appliedKeys - Session keys already accepted or empty-landed
 */
export function collectMutationProposal(
    messages: readonly TProposalThreadMessage[],
    status: TChatStatusForProposal | undefined,
    document: TChatArtifactDocument,
    appliedKeys: ReadonlySet<string>,
): IMutationProposal | null {
    if (status === "streaming") return null;
    if ((document.weeks?.length ?? 0) === 0) return null;

    const pendingKeys: string[] = [];
    const messageIds: string[] = [];
    const mergedOperations: TArtifactOperation[] = [];

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        const message = messages[messageIndex];
        const decision = resolveMutationProposalDecision(
            message,
            messages.slice(messageIndex + 1),
        );
        if (decision === "accepted" || decision === "rejected") continue;

        const parts = message.parts ?? [];
        let messageHasPending = false;
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            if (part.type !== "tool-mutateArtifact") continue;

            const key = `${message.id ?? partIndex}-${partIndex}`;
            if (appliedKeys.has(key)) continue;

            const toolOutput = (part as { output?: TMutateArtifactOutput }).output;
            const operations = toolOutput?.operations;
            if (!operations?.length || toolOutput?.error) continue;

            pendingKeys.push(key);
            mergedOperations.push(...operations);
            messageHasPending = true;
        }
        if (messageHasPending && message.id) {
            messageIds.push(message.id);
        }
    }

    if (mergedOperations.length === 0) return null;

    return {
        keys: pendingKeys,
        messageIds,
        operations: mergedOperations,
    };
}

/**
 * True when the pending batch still fail-all applies to the document on screen.
 *
 * @param document - Current Chat artifact
 * @param proposal - Batch from {@link collectMutationProposal}
 */
export function mutationProposalApplies(
    document: TChatArtifactDocument,
    proposal: IMutationProposal,
): boolean {
    return !isApplyBatchFailure(applyOperations(document, proposal.operations));
}

/**
 * Streaming lock, plus an open Mutation proposal that still applies.
 *
 * @param messages - Chat thread
 * @param status - Stream status
 * @param document - Current Chat artifact
 * @param appliedKeys - Session keys already accepted or empty-landed
 */
export function isArtifactMutationLockActive(
    messages: readonly TProposalThreadMessage[],
    status: TChatStatusForProposal | undefined,
    document: TChatArtifactDocument,
    appliedKeys: ReadonlySet<string>,
): boolean {
    if (status === "streaming") return true;
    const proposal = collectMutationProposal(messages, status, document, appliedKeys);
    if (!proposal) return false;
    return mutationProposalApplies(document, proposal);
}

/**
 * Accept: apply the pending batch fail-all and commit one undo step.
 *
 * @param document - Current Chat artifact
 * @param proposal - Batch from {@link collectMutationProposal}
 * @param markApplied - Records session idempotency keys after a successful commit
 * @param commitWithUndo - Document commit
 */
export function acceptMutationProposal(
    document: TChatArtifactDocument,
    proposal: IMutationProposal,
    markApplied: (keys: readonly string[]) => void,
    commitWithUndo: (
        next: TChatArtifactDocument,
        options?: { recordUndo?: boolean; proposalMarkKeys?: number[] },
    ) => void,
): boolean {
    const result = applyArtifactProposal(document, proposal.operations);
    if (result.ok === false) {
        const reason = result.failures[0]?.reason ?? "Artifact modification failed.";
        toast.error(reason);
        console.error("mutateArtifact batch failed", result.failures);
        return false;
    }

    const recordUndo = (document.weeks?.length ?? 0) > 0;
    commitWithUndo(result.document, {
        recordUndo,
        ...(recordUndo ? { proposalMarkKeys: result.proposalMarkKeys } : {}),
    });
    markApplied(proposal.keys);
    return true;
}

/**
 * Empty artifact (no weeks): land successful mutateArtifact batches immediately
 * when the stream finishes. No Accept card.
 *
 * @param messages - Chat thread
 * @param status - Stream status
 * @param document - Live Chat artifact
 * @param appliedKeys - Session idempotency keys
 * @param markApplied - Records session idempotency keys after a successful commit
 * @param commitWithUndo - Document commit
 */
export function tryLandEmptyArtifactMutations(
    messages: readonly TProposalThreadMessage[],
    status: TChatStatusForProposal | undefined,
    document: TChatArtifactDocument,
    appliedKeys: ReadonlySet<string>,
    markApplied: (keys: readonly string[]) => void,
    commitWithUndo: (
        next: TChatArtifactDocument,
        options?: { recordUndo?: boolean; proposalMarkKeys?: number[] },
    ) => void,
): boolean {
    if (status === "streaming") return false;
    if ((document.weeks?.length ?? 0) > 0) return false;

    const pendingKeys: string[] = [];
    const mergedOperations: TArtifactOperation[] = [];

    for (const message of messages) {
        const parts = message.parts ?? [];
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];
            if (part.type !== "tool-mutateArtifact") continue;

            const key = `${message.id ?? partIndex}-${partIndex}`;
            if (appliedKeys.has(key)) continue;

            const toolOutput = (part as { output?: TMutateArtifactOutput }).output;
            const operations = toolOutput?.operations;
            if (!operations?.length || toolOutput?.error) continue;

            pendingKeys.push(key);
            mergedOperations.push(...operations);
        }
    }

    if (mergedOperations.length === 0) return false;

    const result = applyOperations(document, mergedOperations);
    if (isApplyBatchFailure(result)) {
        const reason = result.failures[0]?.reason ?? "Artifact modification failed.";
        toast.error(reason);
        console.error("Empty-artifact mutate batch failed", result.failures);
        return false;
    }

    commitWithUndo(result.document, { recordUndo: false });
    markApplied(pendingKeys);
    return true;
}
