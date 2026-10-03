/**
 * @module artifact-builder/mutations/agentSchema
 *
 * Agent-facing input schema for mutateArtifact (ADR 0034 / 03).
 *
 * Depends on: catalog, schemas, zod
 * Used by: barrel index, chat tools (slice 5), tools tests
 */

import { z } from "zod";

import { agentExposedArtifactMutations } from "./catalog";
import { artifactOperationSchema } from "./schemas";

/** All catalog ops are agent-exposed; reuse the full discriminated union. */
export const mutateArtifactOperationSchema = artifactOperationSchema;

export const mutateArtifactInputSchema = z.object({
    operations: z
        .array(mutateArtifactOperationSchema)
        .min(1)
        .describe("Fail-all batch of Chat artifact mutations."),
});

export type TMutateArtifactInput = z.infer<typeof mutateArtifactInputSchema>;

export function buildMutateArtifactToolDescription(): string {
    const lines = agentExposedArtifactMutations.map(
        (mutation) => `- ${mutation.id}: ${mutation.description}`,
    );
    return [
        "Apply one or more typed operations to the Chat artifact (fail-all batch).",
        "When the artifact already has weeks, call readArtifact in the same turn first and target weekIndex / dayId / itemId from that snapshot.",
        "On a non-empty artifact the batch is a Mutation proposal until the user Accepts — do not claim the grid already changed.",
        "On an empty artifact (no weeks) the first mutate may land immediately without Accept.",
        "Ops:",
        ...lines,
    ].join("\n");
}
