/**
 * @module ArtifactMutationContext
 *
 * React bridge for the Chat artifact mutation registry — commitWithUndo,
 * runMutation, proposal marks (ADR 0034 / 03). Soft-fail and Hevy day-locks
 * are out of scope.
 *
 * Depends on: mutations/registry, mutations/types
 * Used by: Dashboard shell, day-card UI (slice 4), proposal Accept
 */

"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    type ReactNode,
} from "react";
import { toast } from "sonner";

import { runArtifactMutation } from "@/components/artifact-builder/mutations/registry";
import {
    isValidationFailure,
    type TCommitArtifactWithUndoOptions,
    type TMutationResult,
} from "@/components/artifact-builder/mutations/types";

const EMPTY_MARK_KEYS: ReadonlySet<number> = new Set();

interface IArtifactMutationContext {
    document: TChatArtifactDocument;
    commitWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    setDocumentFromHydrate: (document: TChatArtifactDocument) => void;
    isAgentStreaming: boolean;
    runMutation: (id: string, args: Record<string, unknown>) => TMutationResult;
    proposalMarkKeys: ReadonlySet<number>;
}

const ArtifactMutationContext = createContext<IArtifactMutationContext | undefined>(
    undefined,
);

interface IArtifactMutationProviderProps {
    document: TChatArtifactDocument;
    commitWithUndo: (
        next: TChatArtifactDocument,
        options?: TCommitArtifactWithUndoOptions,
    ) => void;
    setDocumentFromHydrate: (document: TChatArtifactDocument) => void;
    isAgentStreaming?: boolean;
    proposalMarkKeys?: readonly number[];
    children: ReactNode;
}

export function ArtifactMutationProvider({
    document,
    commitWithUndo,
    setDocumentFromHydrate,
    isAgentStreaming = false,
    proposalMarkKeys = [],
    children,
}: IArtifactMutationProviderProps) {
    const markKeySet = useMemo(() => new Set(proposalMarkKeys), [proposalMarkKeys]);

    const runMutation = useCallback(
        (id: string, args: Record<string, unknown>) => {
            const result = runArtifactMutation(id, args, {
                document,
                commitWithUndo,
                isAgentStreaming,
            });

            if (isValidationFailure(result)) {
                toast.error(result.reason);
            }

            return result;
        },
        [document, commitWithUndo, isAgentStreaming],
    );

    const value = useMemo<IArtifactMutationContext>(
        () => ({
            document,
            commitWithUndo,
            setDocumentFromHydrate,
            isAgentStreaming,
            runMutation,
            proposalMarkKeys: markKeySet,
        }),
        [
            document,
            commitWithUndo,
            setDocumentFromHydrate,
            isAgentStreaming,
            runMutation,
            markKeySet,
        ],
    );

    return (
        <ArtifactMutationContext.Provider value={value}>
            {children}
        </ArtifactMutationContext.Provider>
    );
}

export function useArtifactMutation(): IArtifactMutationContext {
    const context = useContext(ArtifactMutationContext);
    if (!context) {
        throw new Error("useArtifactMutation must be used within ArtifactMutationProvider");
    }
    return context;
}

/** Agent streaming lock — safe outside the provider (defaults to false). */
export function useIsAgentStreaming(): boolean {
    return useContext(ArtifactMutationContext)?.isAgentStreaming ?? false;
}

/** Live Mutation proposal mark keys — empty outside the provider. */
export function useProposalMarkKeys(): ReadonlySet<number> {
    return useContext(ArtifactMutationContext)?.proposalMarkKeys ?? EMPTY_MARK_KEYS;
}
