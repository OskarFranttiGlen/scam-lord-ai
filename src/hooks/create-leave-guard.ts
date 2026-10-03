/**
 * @module create-leave-guard
 * Dirty-form leave confirmation for the dual-pane builder (ADR 0034 / 01).
 * Depends on: react, builder-draft, AUTH_LOGIN_PATH patterns.
 * Used by: AppSidebar, Dashboard leave flows.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { BUILDER_DRAFT_KEY, clearBuilderDraft } from "@/lib/builder-draft";

type TLeaveGuardOptions = {
    title: string;
    description: string;
    /** Called when the user confirms discard (before navigation). */
    onDiscard?: () => void;
};

type TLeaveGuardApi = {
    useLeaveGuard: () => {
        leaveDialogOpen: boolean;
        pendingHref: string | null;
        setDirty: (dirty: boolean) => void;
        onDiscardLeave: () => void;
        onLeaveDialogOpenChange: (open: boolean) => void;
        title: string;
        description: string;
    };
    requestLeave: (href: string, beforeNavigate?: () => void) => boolean;
    __resetForTests: () => void;
};

function isAuthHref(href: string): boolean {
    try {
        const path = href.startsWith("http")
            ? new URL(href).pathname
            : href.split("?")[0] ?? href;
        return path === "/auth" || path.startsWith("/auth/");
    } catch {
        return href.includes("/auth/");
    }
}

function resolveHrefFromAnchor(anchor: HTMLAnchorElement): string | null {
    const raw = anchor.getAttribute("href");
    if (!raw || raw.startsWith("#")) return null;
    if (raw.startsWith("mailto:") || raw.startsWith("tel:")) return null;
    return raw;
}

/**
 * Factory for a document-level leave guard (beforeunload + same-origin link clicks).
 */
export function createLeaveGuard(options: TLeaveGuardOptions): TLeaveGuardApi {
    let dirty = false;
    let leaveDialogOpen = false;
    let pendingHref: string | null = null;
    let pendingBeforeNavigate: (() => void) | null = null;
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) listener();
    };

    const setDirtyInternal = (next: boolean) => {
        dirty = next;
        notify();
    };

    const openLeave = (href: string, beforeNavigate?: () => void) => {
        pendingHref = href;
        pendingBeforeNavigate = beforeNavigate ?? null;
        leaveDialogOpen = true;
        notify();
    };

    const onClickCapture = (event: MouseEvent) => {
        if (!dirty || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const href = resolveHrefFromAnchor(anchor);
        if (!href) return;
        if (isAuthHref(href)) return;
        event.preventDefault();
        openLeave(href);
    };

    const onBeforeUnload = (event: Event) => {
        if (!dirty) return;
        event.preventDefault();
        (event as BeforeUnloadEvent).returnValue = "";
    };

    let attached = false;
    const attach = () => {
        if (attached || typeof window === "undefined") return;
        attached = true;
        document.addEventListener("click", onClickCapture, true);
        window.addEventListener("beforeunload", onBeforeUnload);
    };

    const detach = () => {
        if (!attached || typeof window === "undefined") return;
        attached = false;
        document.removeEventListener("click", onClickCapture, true);
        window.removeEventListener("beforeunload", onBeforeUnload);
    };

    return {
        useLeaveGuard: () => {
            const [, setTick] = useState(0);
            useEffect(() => {
                const listener = () => setTick((n) => n + 1);
                listeners.add(listener);
                attach();
                return () => {
                    listeners.delete(listener);
                    if (listeners.size === 0) detach();
                };
            }, []);

            const setDirty = useCallback((next: boolean) => {
                setDirtyInternal(next);
            }, []);

            const onDiscardLeave = useCallback(() => {
                options.onDiscard?.();
                setDirtyInternal(false);
                pendingBeforeNavigate?.();
                pendingBeforeNavigate = null;
                if (pendingHref && typeof window !== "undefined") {
                    window.location.assign(pendingHref);
                }
            }, []);

            const onLeaveDialogOpenChange = useCallback((open: boolean) => {
                leaveDialogOpen = open;
                if (!open) {
                    pendingHref = null;
                    pendingBeforeNavigate = null;
                }
                notify();
            }, []);

            return {
                leaveDialogOpen,
                pendingHref,
                setDirty,
                onDiscardLeave,
                onLeaveDialogOpenChange,
                title: options.title,
                description: options.description,
            };
        },
        requestLeave: (href, beforeNavigate) => {
            if (!dirty) return false;
            if (isAuthHref(href)) return false;
            openLeave(href, beforeNavigate);
            return true;
        },
        __resetForTests: () => {
            dirty = false;
            leaveDialogOpen = false;
            pendingHref = null;
            pendingBeforeNavigate = null;
            detach();
            notify();
        },
    };
}

/** Builder leave guard that clears the local draft on discard. */
export const newPathLeaveGuard = createLeaveGuard({
    title: "Discard unsaved changes?",
    description: "Leave without saving your draft?",
    onDiscard: () => {
        try {
            clearBuilderDraft();
            localStorage.removeItem(BUILDER_DRAFT_KEY);
        } catch {
            // ignore
        }
    },
});
