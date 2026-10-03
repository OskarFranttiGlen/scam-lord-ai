/**
 * @module artifact-builder/mutations/registry
 *
 * UI path: parse + run one catalog mutation and commit with undo (ADR 0034 / 03).
 *
 * Depends on: catalog, types
 * Used by: ArtifactMutationContext
 */

import { artifactMutationCatalogById } from "./catalog";
import {
    isValidationFailure,
    mutationFailure,
    type TArtifactMutationRunContext,
    type TMutationResult,
} from "./types";

const STREAMING_FAILURE = "Can't edit the artifact while the assistant is responding.";

/**
 * Run a catalog mutation against `ctx.document` and commit on success.
 * Does not toast — callers (e.g. ArtifactMutationContext) surface failures.
 *
 * @param id - Catalog op id
 * @param args - Op args without `op` (or with `op` matching id)
 * @param ctx - Document + commit + streaming lock
 */
export function runArtifactMutation(
    id: string,
    args: Record<string, unknown>,
    ctx: TArtifactMutationRunContext,
): TMutationResult {
    if (ctx.isAgentStreaming) {
        return mutationFailure(STREAMING_FAILURE);
    }

    const mutation = artifactMutationCatalogById[id];
    if (!mutation) {
        return mutationFailure(`Unknown operation: ${id}`);
    }

    const parsed = mutation.schema.safeParse({ op: id, ...args });
    if (!parsed.success) {
        return mutationFailure(
            parsed.error.issues.map((issue) => issue.message).join("; "),
        );
    }

    const result = mutation.run(ctx.document, parsed.data);
    if (isValidationFailure(result)) {
        return result;
    }

    ctx.commitWithUndo(result.document);
    return result;
}

export const artifactMutationRegistry = {
    run: runArtifactMutation,
};
