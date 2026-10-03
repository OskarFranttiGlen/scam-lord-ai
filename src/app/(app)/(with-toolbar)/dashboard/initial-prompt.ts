/**
 * @module initial-prompt
 * Arrival prompt / attachment helpers for the dual-pane shell (ADR 0034 / 01).
 * Depends on: ui-constants.
 * Used by: use-dashboard-chat, resolve-chat-entry.
 */

import type { FileUIPart } from "ai";
import {
    LONG_PROMPT_PLACEHOLDER,
    PENDING_ATTACHMENTS_KEY,
    PENDING_INITIAL_PROMPT_KEY,
} from "@/assets/constants/ui-constants";

/** True when the `shareId` query param should load a shared program from the API. */
export function isValidShareId(shareId: string): boolean {
    if (!shareId.trim()) return false;
    const n = Number(shareId);
    return Number.isFinite(n) && n > 0;
}

export function resolveInitialPromptText(search: string): string {
    if (search !== LONG_PROMPT_PLACEHOLDER) return search;
    if (typeof sessionStorage === "undefined") return "";
    return sessionStorage.getItem(PENDING_INITIAL_PROMPT_KEY) ?? "";
}

export function clearLongPromptFromSessionStorage(isLongPromptPlaceholder: boolean): void {
    if (!isLongPromptPlaceholder || typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(PENDING_INITIAL_PROMPT_KEY);
}

export function readPendingAttachmentFileParts(): FileUIPart[] | undefined {
    if (typeof sessionStorage === "undefined") return undefined;
    try {
        const stored = sessionStorage.getItem(PENDING_ATTACHMENTS_KEY);
        if (!stored) return undefined;
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return undefined;
        const files = parsed.filter(
            (p): p is FileUIPart =>
                p != null &&
                typeof p === "object" &&
                p.type === "file" &&
                typeof (p as FileUIPart).url === "string",
        );
        sessionStorage.removeItem(PENDING_ATTACHMENTS_KEY);
        return files.length > 0 ? files : undefined;
    } catch {
        return undefined;
    }
}
