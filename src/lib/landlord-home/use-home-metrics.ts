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

/** Collection pace and money tiles. Blank until a read lands. */
export function useHomeMetrics() {
    const { user } = useUserContext();
    const query = useQuery({
        queryKey: ["landlord-home-metrics", user?.id],
        queryFn: () => loadHomeMetrics(createClient()),
        enabled: !!user,
    });
    const data = query.data;

    return {
        collectionRate: data?.collectionRate ?? null,
        medianResolutionMinutes: data?.medianResolutionMinutes ?? null,
        averageTouches: data?.averageTouches ?? null,
        recovered: data?.recovered ?? null,
        stillOverdue: data?.stillOverdue ?? null,
        promised: data?.promised ?? null,
        loading: query.isLoading,
    };
}
