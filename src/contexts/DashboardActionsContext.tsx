"use client";

/**
 * Imperative bridge for dashboard actions callable from app shell (e.g. sidebar).
 * Dashboard registers `clearChat` during render; callers invoke it on user action.
 */

import { createContext, useContext, useMemo, useRef, type ReactNode, type RefObject } from "react";

type TClearChatFn = () => void;
type TGetPersistChatIdFn = () => string;

interface IDashboardActionsContext {
    clearChatRef: RefObject<TClearChatFn | null>;
    clearChat: () => void;
    /** Registered on dashboard; export reads URL + mint ref at save time. */
    getPersistChatIdRef: RefObject<TGetPersistChatIdFn | null>;
}

const DashboardActionsContext = createContext<IDashboardActionsContext | undefined>(undefined);

export function DashboardActionsProvider({ children }: { children: ReactNode }) {
    const clearChatRef = useRef<TClearChatFn | null>(null);
    const getPersistChatIdRef = useRef<TGetPersistChatIdFn | null>(null);
    const value = useMemo<IDashboardActionsContext>(
        () => ({
            clearChatRef,
            clearChat: () => clearChatRef.current?.(),
            getPersistChatIdRef,
        }),
        [],
    );

    return <DashboardActionsContext.Provider value={value}>{children}</DashboardActionsContext.Provider>;
}

export function useDashboardActions() {
    const context = useContext(DashboardActionsContext);
    if (!context) {
        throw new Error("useDashboardActions must be used within DashboardActionsProvider");
    }
    return context;
}
