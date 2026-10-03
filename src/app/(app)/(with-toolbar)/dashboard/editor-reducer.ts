/**
 * @module editor-reducer
 * Builder Chat artifact document + hollow grid + undo stack (ADR 0034 / 03).
 * Proposal-mark keys still accepted for Accept/Reject Mutation proposals.
 *
 * Depends on: EMPTY_CHAT_ARTIFACT_DOCUMENT
 * Used by: Dashboard, tests.
 */

import { EMPTY_CHAT_ARTIFACT_DOCUMENT } from "@/api/artifacts";

/** Max undo snapshots retained; oldest dropped on overflow. */
export const UNDO_STACK_CAP = 100;

/** Options for commitWithUndo from the dual-pane shell. */
export type TCommitWithUndoOptions = {
    recordUndo?: boolean;
    proposalMarkKeys?: number[];
};

/** One undo snapshot: hollow grid fossil + Chat artifact document. */
export type TEditorSnapshot = {
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
};

/** Editor state: document + grid shell + snapshot undo stack. */
export type TEditorState = {
    artifactProgram: TArtifactDay[];
    artifactDocument: TChatArtifactDocument;
    undoStack: TEditorSnapshot[];
    proposalMarks: { keys: number[]; undoFloor: number } | null;
};

export type TEditorAction =
    | {
          type: "COMMIT_PROGRAM";
          program?: TArtifactDay[];
          updater?: (prev: TArtifactDay[]) => TArtifactDay[];
          recordUndo?: boolean;
          /** Accept-only. Replaces the live mark set; omit to keep current marks. */
          proposalMarkKeys?: number[];
      }
    | {
          type: "COMMIT_DOCUMENT";
          document: TChatArtifactDocument;
          recordUndo?: boolean;
          proposalMarkKeys?: number[];
      }
    | { type: "UNDO" }
    | {
          type: "REPLACE_PROGRAM";
          program: TArtifactDay[];
          document?: TChatArtifactDocument;
      }
    /** After successful New-path Save: current grid is baseline; dirty clears. */
    | { type: "CLEAR_UNDO_BASELINE" };

/** Undo-stack dirty only (after a Save baseline exists). */
export function isNewPathDirty(undoStackLength: number): boolean {
    return undoStackLength > 0;
}

/**
 * New-path Save/leave dirty: never Saved with at least one Artifact item, or
 * undo stack non-empty vs last Save. Empty day shells are not dirty.
 *
 * @param undoStackLength - Snapshots since last Save
 * @param hasSaveBaseline - True after a successful Save this session
 * @param hasProgramContent - Any day has Artifact item rows
 */
export function isNewPathSaveDirty(
    undoStackLength: number,
    hasSaveBaseline: boolean,
    hasProgramContent: boolean,
): boolean {
    if (!hasSaveBaseline) {
        return hasProgramContent;
    }
    return undoStackLength > 0;
}

export function createInitialEditorState(
    artifactProgram: TArtifactDay[] = [],
    artifactDocument: TChatArtifactDocument = EMPTY_CHAT_ARTIFACT_DOCUMENT,
): TEditorState {
    return {
        artifactProgram,
        artifactDocument,
        undoStack: [],
        proposalMarks: null,
    };
}

function snapshotOf(state: TEditorState): TEditorSnapshot {
    return {
        artifactProgram: state.artifactProgram,
        artifactDocument: state.artifactDocument,
    };
}

function pushUndo(state: TEditorState, recordUndo: boolean): TEditorSnapshot[] {
    if (!recordUndo) {
        return state.undoStack;
    }
    let undoStack = [...state.undoStack, snapshotOf(state)];
    if (undoStack.length > UNDO_STACK_CAP) {
        undoStack = undoStack.slice(undoStack.length - UNDO_STACK_CAP);
    }
    return undoStack;
}

function nextProposalMarks(
    state: TEditorState,
    undoStack: TEditorSnapshot[],
    proposalMarkKeys: number[] | undefined,
    recordUndo: boolean,
): TEditorState["proposalMarks"] {
    if (proposalMarkKeys === undefined) {
        return state.proposalMarks;
    }
    if (proposalMarkKeys.length === 0) {
        return null;
    }
    // Accept without an undo floor cannot jump back past the mark set.
    if (!recordUndo) {
        return null;
    }
    return { keys: proposalMarkKeys, undoFloor: undoStack.length };
}

/** Toolbar Save disable. Signed in, chat idle, and save-dirty. */
export type TNewPathToolbarSaveDisabledInput = {
    hasProgramContent: boolean;
    hasSaveBaseline: boolean;
    isLoading: boolean;
    isSaving: boolean;
    undoStackLength: number;
    userPresent: boolean;
};

/**
 * New-path toolbar Save disable. Signed in, chat idle, and save-dirty.
 * Does not require a chat message.
 *
 * @param input - User, in-flight, and dirty snapshot
 */
export function isNewPathToolbarSaveDisabled(
    input: TNewPathToolbarSaveDisabledInput,
): boolean {
    return (
        !input.userPresent
        || input.isSaving
        || input.isLoading
        || !isNewPathSaveDirty(
            input.undoStackLength,
            input.hasSaveBaseline,
            input.hasProgramContent,
        )
    );
}

export function editorReducer(
    state: TEditorState,
    action: TEditorAction,
): TEditorState {
    switch (action.type) {
        case "REPLACE_PROGRAM":
            return {
                artifactProgram: action.program,
                artifactDocument: action.document ?? EMPTY_CHAT_ARTIFACT_DOCUMENT,
                undoStack: [],
                proposalMarks: null,
            };
        case "CLEAR_UNDO_BASELINE":
            if (state.undoStack.length === 0 && state.proposalMarks === null) {
                return state;
            }
            return {
                ...state,
                undoStack: [],
                proposalMarks: null,
            };
        case "COMMIT_PROGRAM": {
            const nextProgram = action.updater
                ? action.updater(state.artifactProgram)
                : (action.program ?? state.artifactProgram);
            const recordUndo = action.recordUndo ?? true;
            if (
                nextProgram === state.artifactProgram
                && action.proposalMarkKeys === undefined
                && recordUndo
            ) {
                return state;
            }
            const undoStack = pushUndo(state, recordUndo);
            return {
                artifactProgram: nextProgram,
                artifactDocument: state.artifactDocument,
                undoStack,
                proposalMarks: nextProposalMarks(
                    state,
                    undoStack,
                    action.proposalMarkKeys,
                    recordUndo,
                ),
            };
        }
        case "COMMIT_DOCUMENT": {
            const recordUndo = action.recordUndo ?? true;
            if (
                action.document === state.artifactDocument
                && action.proposalMarkKeys === undefined
                && recordUndo
            ) {
                return state;
            }
            const undoStack = pushUndo(state, recordUndo);
            return {
                artifactProgram: state.artifactProgram,
                artifactDocument: action.document,
                undoStack,
                proposalMarks: nextProposalMarks(
                    state,
                    undoStack,
                    action.proposalMarkKeys,
                    recordUndo,
                ),
            };
        }
        case "UNDO": {
            if (state.undoStack.length === 0) return state;
            const undoStack = state.undoStack.slice(0, -1);
            const previous = state.undoStack[state.undoStack.length - 1]!;
            const proposalMarks =
                state.proposalMarks != null
                && undoStack.length < state.proposalMarks.undoFloor
                    ? null
                    : state.proposalMarks;
            return {
                artifactProgram: previous.artifactProgram,
                artifactDocument: previous.artifactDocument,
                undoStack,
                proposalMarks,
            };
        }
        default:
            return state;
    }
}
