"use client";

/**
 * @module landlord-home/use-home-metrics
 * Home tiles from Stripe Sync. Missing sync stays blank.
 * Depends on: stripe-metrics, react-query, UserContext.
 * Used by: LandlordHome.
 */

import { useQuery } from "@tanstack/react-query";
import { useUserContext } from "@/contexts/UserContext";
import { createClient } from "@/utils/supabase/client";
import { loadHomeMetrics } from "./stripe-metrics";

/** Recovered, still overdue, promised, and median minutes. Blank until a read lands. */
export function useHomeMetrics() {
    const { user } = useUserContext();
    const query = useQuery({
        queryKey: ["landlord-home-metrics", user?.id],
        queryFn: () => loadHomeMetrics(createClient()),
        enabled: !!user,
    });
    const data = query.data;

    return {
        recovered: data?.recovered ?? null,
        stillOverdue: data?.stillOverdue ?? null,
        promised: data?.promised ?? null,
        medianMinutes: data?.medianMinutes ?? null,
        loading: query.isLoading,
    };
}
