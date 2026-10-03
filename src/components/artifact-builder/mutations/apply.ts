/**
 * @module artifact-builder/mutations/apply
 *
 * Fail-all batch apply for Chat artifact ops (ADR 0034 / 03). On any failure
 * returns the original document; ordinary validation errors only (no Soft-fail).
 *
 * Depends on: catalog, schemas, types
 * Used by: registry, proposal Accept path, mutateArtifact tool (slice 5)
 */

import type { z } from "zod";

import { artifactMutationCatalogById } from "./catalog";
import type { TArtifactOperation } from "./schemas";
import {
    isValidationFailure,
    mutationFailure,
    type TApplyBatchResult,
    type TMutationResult,
} from "./types";

function parseMutationOperation<TSchema extends z.ZodType>(
    operation: Record<string, unknown>,
    schema: TSchema,
):
    | { ok: true; data: z.infer<TSchema> }
    | { ok: false; reason: string } {
    const parsed = schema.safeParse(operation);
    if (!parsed.success) {
        return {
            ok: false,
            reason: parsed.error.issues.map((issue) => issue.message).join("; "),
        };
    }
    return { ok: true, data: parsed.data };
}

/**
 * Apply one typed operation to a Chat artifact document.
 *
 * @param document - Current document
 * @param operation - Discriminated op payload
 */
export function applyOperation(
    document: TChatArtifactDocument,
    operation: TArtifactOperation,
): TMutationResult {
    const mutation = artifactMutationCatalogById[operation.op];
    if (!mutation) {
        return mutationFailure(`Unknown operation: ${operation.op}`);
    }

    const parsed = parseMutationOperation(
        operation as Record<string, unknown>,
        mutation.schema,
    );
    if (parsed.ok === false) {
        return mutationFailure(parsed.reason);
    }

    return mutation.run(document, parsed.data);
}

/**
 * Apply a fail-all batch. First failure rolls back to the original document.
 *
 * @param document - Current document
 * @param operations - Ordered ops
 */
export function applyOperations(
    document: TChatArtifactDocument,
    operations: TArtifactOperation[],
): TApplyBatchResult {
    let nextDocument = document;

    for (let index = 0; index < operations.length; index++) {
        const operation = operations[index];
        const result = applyOperation(nextDocument, operation);
        if (isValidationFailure(result)) {
            return {
                ok: false,
                failures: [{ index, op: operation.op, reason: result.reason }],
                document,
            };
        }
        nextDocument = result.document;
    }

    return { ok: true, document: nextDocument };
}
