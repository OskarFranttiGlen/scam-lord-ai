/**
 * @module builder-draft
 *
 * In-memory draft flag + key for leave-guard / new-chat confirm.
 * No Hevy localStorage payload.
 */

export const BUILDER_DRAFT_KEY = "builder-draft:v1";

const memory = new Map<string, string>();

export function clearBuilderDraft(): void {
    memory.delete(BUILDER_DRAFT_KEY);
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem(BUILDER_DRAFT_KEY);
    }
}

export function canWriteBuilderDraft(): boolean {
    return false;
}

export function enableBuilderDraftWrites(): void {
    // no-op
}

/** Test-only reset. */
export function __resetBuilderDraftForTests(): void {
    memory.clear();
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem(BUILDER_DRAFT_KEY);
    }
}

/** Used by leave-guard tests that still poke the draft key. */
export function __setBuilderDraftForTests(value: string): void {
    memory.set(BUILDER_DRAFT_KEY, value);
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(BUILDER_DRAFT_KEY, value);
    }
}

export function __getBuilderDraftForTests(): string | null {
    if (typeof localStorage !== "undefined") {
        return localStorage.getItem(BUILDER_DRAFT_KEY);
    }
    return memory.get(BUILDER_DRAFT_KEY) ?? null;
}
