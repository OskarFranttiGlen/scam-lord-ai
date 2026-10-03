/**
 * @module artifact-builder/mutations
 *
 * Chat artifact mutation registry barrel (ADR 0034 / 03).
 *
 * Depends on: apply, schemas, catalog, agentSchema, registry, types, proposal-marks
 * Used by: ArtifactMutationContext, chat tools (slice 5), tests
 */

export { applyOperation, applyOperations } from "./apply";
export { applyArtifactProposal, type TApplyArtifactProposalResult } from "./applyProposal";
export {
    artifactMutationCatalog,
    artifactMutationCatalogById,
    agentExposedArtifactMutations,
} from "./catalog";
export {
    mutateArtifactInputSchema,
    mutateArtifactOperationSchema,
    buildMutateArtifactToolDescription,
    type TMutateArtifactInput,
} from "./agentSchema";
export {
    artifactOperationSchema,
    type TArtifactOperation,
} from "./schemas";
export {
    runArtifactMutation,
    artifactMutationRegistry,
} from "./registry";
export {
    collectArtifactProposalMarkKeys,
    findWeekIndexForArtifactMarkKey,
    hashArtifactIdToMarkKey,
    isProposalMarkedId,
} from "./proposal-marks";
export {
    mutationSuccess,
    mutationFailure,
    isValidationFailure,
    isApplyBatchFailure,
    type TMutationResult,
    type TApplyBatchResult,
    type TCommitArtifactWithUndoOptions,
    type TArtifactMutationRunContext,
} from "./types";
