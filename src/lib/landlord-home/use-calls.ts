"use client";

/**
 * @module landlord-home/use-calls
 * Dashboard read of the landlord's calls. Realtime refetches the same query.
 * Depends on: load-calls, changed-step, react-query, UserContext.
 * Used by: LandlordHome.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IAgent } from "@/lib/agent-floor/agents";
import { useUserContext } from "@/contexts/UserContext";
import { createClient } from "@/utils/supabase/client";
import { changedStep } from "./changed-step";
import { loadCalls } from "./load-calls";

const FLASH_MS = 1600;

function callsKey(userId: string) {
    return ["landlord-calls", userId] as const;
}

/** Agents on the floor, plus loading and error. Empty when signed out or the portfolio has no calls. */
export function useCalls() {
    const { user } = useUserContext();
    const userId = user?.id;
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["landlord-calls", userId],
        queryFn: () => loadCalls(createClient()),
        enabled: !!userId,
    });
    const [flash, setFlash] = useState<{ id: string; step: string } | null>(null);
    const flashTimer = useRef<number | null>(null);

    useEffect(() => {
        if (!userId) return;
        let live = true;
        const supabase = createClient();
        const key = callsKey(userId);
        const channel = supabase
            .channel(`calls:${userId}:${crypto.randomUUID()}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "calls" },
                () => {
                    const prev = queryClient.getQueryData<IAgent[]>(key) ?? [];
                    void queryClient.invalidateQueries({ queryKey: key }).then(() => {
                        if (!live) return;
                        const hit = changedStep(prev, queryClient.getQueryData<IAgent[]>(key) ?? []);
                        if (!hit) return;
                        setFlash(hit);
                        if (flashTimer.current) window.clearTimeout(flashTimer.current);
                        flashTimer.current = window.setTimeout(() => {
                            if (live) setFlash(null);
                        }, FLASH_MS);
                    }, () => undefined);
                },
            )
            .subscribe();
        return () => {
            live = false;
            if (flashTimer.current) window.clearTimeout(flashTimer.current);
            void supabase.removeChannel(channel);
        };
    }, [queryClient, userId]);

    return {
        agents: query.data ?? [],
        loading: query.isLoading,
        error: query.error ?? null,
        flash,
    };
}
