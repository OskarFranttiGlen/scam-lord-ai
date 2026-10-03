"use client";

/**
 * @module landlord-home/use-calls
 * Dashboard read of the landlord's calls.
 * Depends on: load-calls, react-query, UserContext.
 * Used by: LandlordHome.
 */

import { useQuery } from "@tanstack/react-query";
import { useUserContext } from "@/contexts/UserContext";
import { createClient } from "@/utils/supabase/client";
import { loadCalls } from "./load-calls";

/** Agents on the floor, plus loading and error. Empty when signed out or the portfolio has no calls. */
export function useCalls() {
    const { user } = useUserContext();
    const query = useQuery({
        queryKey: ["landlord-calls", user?.id],
        queryFn: () => loadCalls(createClient()),
        enabled: !!user,
    });

    return {
        agents: query.data ?? [],
        loading: query.isLoading,
        error: query.error ?? null,
    };
}
