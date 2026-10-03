/**
 * @module artifact-builder/mutations/types
 *
 * Result types for Chat artifact mutations (ADR 0034 / 03). Fail-all batches
 * return the original document; no Soft-fail channel.
 *
 * Depends on: zod
 * Used by: handlers, catalog, apply, registry, ArtifactMutationContext
 */

import type { z } from "zod";

export type TValidationFailure = {
    ok: false;
    reason: string;
};

export type TMutationSuccess = {
    ok: true;
    document: TChatArtifactDocument;
};

export type TMutationResult = TMutationSuccess | TValidationFailure;

export function mutationSuccess(document: TChatArtifactDocument): TMutationSuccess {
    return { ok: true, document };
}

export function mutationFailure(reason: string): TValidationFailure {
    return { ok: false, reason };
}

export function isValidationFailure(result: TMutationResult): result is TValidationFailure {
    return !result.ok;
}

export function isApplyBatchFailure(result: TApplyBatchResult): result is TApplyBatchFailure {
    return !result.ok;
}

export type TArtifactMutationDefinition<TSchema extends z.ZodType = z.ZodType> = {
    id: string;
    description: string;
    schema: TSchema;
    agentExposed: boolean;
    run: (document: TChatArtifactDocument, args: z.infer<TSchema>) => TMutationResult;
};

export type TApplyBatchSuccess = {
    ok: true;
    document: TChatArtifactDocument;
};

export type TApplyBatchFailure = {
    ok: false;
    failures: Array<{ index: number; op: string; reason: string }>;
    document: TChatArtifactDocument;
};

export type TApplyBatchResult = TApplyBatchSuccess | TApplyBatchFailure;

export type TCommitArtifactWithUndoOptions = {
    recordUndo?: boolean;
    /** Accept-only. Replaces live Mutation proposal marks; omit on manual commits. */
    proposalMarkKeys?: number[];
};

export type TArtifactMutationRunContext = {
    document: TChatArtifactDocument;
    commitWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    isAgentStreaming: boolean;
};
