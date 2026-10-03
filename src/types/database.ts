/**
 * @module types/database
 *
 * Hand types for the RentRecovery keep-set until `src/hooks/supabase.ts`
 * is regenerated from prod (landlords/calls/…) plus users/chat_history.
 */

export type TFeatureLimits = {
    user_id: string;
    tier: string;
    has_active_subscription: boolean | null;
    max_monthly_exports: number;
    monthly_exports_used: number;
    remaining_exports: number;
    max_monthly_llm_requests: number;
    monthly_llm_requests_used: number;
    remaining_llm_requests: number;
    period_start: string | null;
    resets_on: string | null;
};

export type TUserDetails = {
    first_name: string;
    last_name: string;
    username: string;
    bio: string;
    created_at: string;
};

export type TBlog = {
    id: number;
    created_at: string;
    updated_at: string;
    title: string;
    subtitle: string;
    content: object;
    time: number;
    media_url: string;
    image_url?: string;
};

export type TFollowersRow = {
    follower_id: string | null;
    users: {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
    } | null;
};

export type TFollowingRow = {
    following_id: string | null;
    users: {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
    } | null;
};
