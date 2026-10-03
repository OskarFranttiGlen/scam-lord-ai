/**
 * @module artifact-builder/mutations/defineArtifactMutation
 *
 * Factory for catalog entries (ADR 0034 / 03).
 *
 * Depends on: types
 * Used by: catalog
 */

import type { z } from "zod";

import type { TArtifactMutationDefinition } from "./types";

export function defineArtifactMutation<TSchema extends z.ZodType>(
    config: Omit<TArtifactMutationDefinition<TSchema>, "agentExposed"> & {
        agentExposed?: boolean;
    },
): TArtifactMutationDefinition<TSchema> {
    return {
        ...config,
        agentExposed: config.agentExposed ?? true,
    };
}
