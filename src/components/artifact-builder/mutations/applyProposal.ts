/**
 * @module artifact-builder/mutations/applyProposal
 *
 * Accept-path helper: fail-all apply + Mutation proposal mark keys (ADR 0034 / 03).
 *
 * Depends on: apply, proposal-marks, schemas, types
 * Used by: proposal Accept UI (when restored), mutateArtifact consumers
 */

import { applyOperations } from "./apply";
import { collectArtifactProposalMarkKeys } from "./proposal-marks";
import type { TArtifactOperation } from "./schemas";
import type { TApplyBatchFailure } from "./types";

export type TApplyArtifactProposalSuccess = {
    ok: true;
    document: TChatArtifactDocument;
    proposalMarkKeys: number[];
};

export type TApplyArtifactProposalResult =
    | TApplyArtifactProposalSuccess
    | TApplyBatchFailure;

/**
 * Apply a standalone Mutation proposal batch and collect Accept mark keys.
 *
 * @param document - Document before Accept
 * @param operations - Fail-all op batch
 */
export function applyArtifactProposal(
    document: TChatArtifactDocument,
    operations: TArtifactOperation[],
): TApplyArtifactProposalResult {
    const result = applyOperations(document, operations);
    if (result.ok === false) {
        return result;
    }
    return {
        ok: true,
        document: result.document,
        proposalMarkKeys: collectArtifactProposalMarkKeys(operations, result.document),
    };
}
