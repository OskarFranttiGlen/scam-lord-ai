/**
 * @module chat/tools/mutate-artifact-execute
 *
 * Pure execute body for mutateArtifact (ADR 0034 / 05). Kept free of the AI SDK
 * tool wrapper so tests can call it without ToolExecutionOptions casts.
 *
 * Depends on: mutations/apply, mutations/schemas, ./read-artifact
 * Used by: tools.ts, tools tests
 */

import {
    applyOperations,
    isApplyBatchFailure,
} from "@/components/artifact-builder/mutations";
import type { TArtifactOperation } from "@/components/artifact-builder/mutations/schemas";
import {
    artifactSnapshotHasContent,
    readArtifactSnapshot,
} from "./read-artifact";

export type TMutateArtifactToolSuccess = {
    operations: TArtifactOperation[];
};

export type TMutateArtifactToolFailure = {
    error: string;
    message?: string;
    failures?: Array<{ index: number; op: string; reason: string }>;
};

export type TMutateArtifactToolResult =
    | TMutateArtifactToolSuccess
    | TMutateArtifactToolFailure;

/**
 * Validate a mutateArtifact batch against the request-start snapshot.
 *
 * @param artifactDocument - Request-start Chat artifact
 * @param operations - Fail-all op batch
 * @param readArtifactCalledThisTurn - Whether readArtifact ran earlier this turn
 */
export function runMutateArtifactTool(
    artifactDocument: TChatArtifactDocument | undefined,
    operations: TArtifactOperation[],
    readArtifactCalledThisTurn: boolean,
): TMutateArtifactToolResult {
    try {
        if (
            artifactSnapshotHasContent(artifactDocument)
            && !readArtifactCalledThisTurn
        ) {
            return {
                error: "readArtifact_required",
                message:
                    "Call readArtifact before mutateArtifact when the artifact already has weeks. " +
                    "Use weekIndex, dayId, and itemId from that snapshot, not from an earlier turn.",
            };
        }

        const base = readArtifactSnapshot(artifactDocument);
        const result = applyOperations(base, operations);
        if (isApplyBatchFailure(result)) {
            return {
                error: "Artifact mutation batch failed",
                failures: result.failures,
            };
        }

        return { operations };
    } catch (error) {
        console.error("Error in mutateArtifact tool:", error);
        return {
            error: "Failed to validate mutation batch",
            failures: [
                {
                    index: 0,
                    op: operations[0]?.op ?? "unknown",
                    reason: error instanceof Error ? error.message : "Unknown error",
                },
            ],
        };
    }
}
