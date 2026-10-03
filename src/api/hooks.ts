/**
 * @module api/hooks
 *
 * React Query hooks that wrap Supabase API calls used on the client. Each hook declares a stable `queryKey`, enables/disables itself based
 * on prerequisite data (e.g. `enabled: !!user`), and returns standard React
 * Query result objects.
 *
 * The file also contains "SSR hooks" - async functions named `use*SSR` that
 * are called directly in server components / `getServerSideProps` to prefetch
 * data without React Query.
 *
 * NOTE: React Query is strictly client-side. For server-side data fetching,
 * use the SSR functions at the bottom of this file.
 *
 * Depends on: @tanstack/react-query, ./users, ./feature-limits, ./chat-history
 * Used by: virtually every page and component that renders dynamic data
 */
import { useQuery } from "@tanstack/react-query";
import { getUserFullName, getUserMetaData } from "./users";
import { getMyFeatureLimits } from "./feature-limits";
import { User } from "@supabase/supabase-js";
import { getChatHistoryById, getChatIds } from "./chat-history";


/* ================================
   CLIENT-SIDE RENDERED HOOKS
   ================================ */

/**
 * Resolves a user's full name from a user UUID.
 *
 * @param id - A user UUID
 */
export const useUserFullName = (id: string | number | undefined) => {
    return useQuery({
        queryKey: ["full-name", id],
        queryFn: () => getUserFullName(id),
        enabled: !!id,
    });
};


/**
 * Fetches a user's public metadata (name, username, bio) by their UUID.
 *
 * @param id - The user's UUID
 */
export const useUserMetadata = (id: string) => {
    return useQuery({
        queryKey: ['user-metadata', id],
        queryFn: () => getUserMetaData(id),
        enabled: !!id,
    });
};




/**
 * Fetches a chat history by chat ID.
 *
 * @param user - The authenticated user
 * @param chatId - The chat ID
 * @param options.enabled - When false, skips fetch (e.g. until send-time insert confirms - Sub-plan 2 gate)
 */
export const useChatHistory = (
    user: User | undefined | null,
    chatId: string,
    options?: { enabled?: boolean },
) => {
    const gateEnabled = options?.enabled ?? true;
    return useQuery({
        queryKey: ['chat-history', user?.id, chatId],
        queryFn: () => getChatHistoryById(user, chatId),
        enabled: !!user && !!chatId && gateEnabled,
    });
};

/**
 * Fetches the chat IDs for the authenticated user.
 *
 * @param user - The authenticated user
 */
export const useChatIds = (user: User | undefined | null) => {
    return useQuery({
        queryKey: ['chat-ids', user?.id],
        queryFn: () => getChatIds(user),
        enabled: !!user,
    });
};


/*
 * Fetches the current user's feature limits (export cap, LLM request cap),
 * falling back to anonymous localStorage limits when not logged in.
 *
 * @param user - The Supabase auth user, or null for anonymous access
 */
export const useMyFeatureLimits = (user: User | undefined | null) => {
    return useQuery({
        queryKey: ["feature-limits", user?.id],
        queryFn: () => getMyFeatureLimits(user),
    });
};


/* ================================
   SERVER-SIDE RENDERED HOOKS
   ================================ */



/**
 * Server-side variant of `useUserFullName`. Directly returns the promise.
 *
 * @param id - The user's UUID
 */
export const useUserFullNameSSR = (id: string | number) => {
    return getUserFullName(id);
};

/**
 * Server-side variant of `useUserMetadata`. Directly returns the promise.
 *
 * @param id - The user's UUID
 */
export const useUserMetadataSSR = (id: string) => {
    return getUserMetaData(id);
};
