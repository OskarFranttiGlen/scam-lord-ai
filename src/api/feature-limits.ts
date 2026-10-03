/**
 * @module api/featureLimits
 *
 * Unmetered limits for the RentRecovery agent shell.
 * Shipworthy Free/Pro Stripe caps and localStorage anonymous meters are gone.
 * Authenticated and anonymous callers both get uncapped LLM access.
 *
 * Depends on: @supabase/supabase-js (User type)
 * Used by: hooks.ts (useMyFeatureLimits), test-user debug toggles
 */
import { User } from "@supabase/supabase-js";

const TEST_USER_EMAILS = (
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_TEST_USER_EMAILS
        ? process.env.NEXT_PUBLIC_TEST_USER_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
        : []
) as string[];

export const TEST_TIER_OVERRIDE_KEY = "proxima_test_tier_override";

export type TTestTierOverride = "free" | "pro" | "pro_plus";

/** Kept for TestUserDebugModeToggle / leftover UI; not enforced. */
export const TEST_TIER_LIMITS: Record<TTestTierOverride, { tier: string; has_active_subscription: boolean; max_monthly_exports: number; max_monthly_llm_requests: number }> = {
    free: { tier: "Free", has_active_subscription: false, max_monthly_exports: 2, max_monthly_llm_requests: 45 },
    pro: { tier: "Pro", has_active_subscription: true, max_monthly_exports: 3, max_monthly_llm_requests: 100 },
    pro_plus: { tier: "Pro+", has_active_subscription: true, max_monthly_exports: 10, max_monthly_llm_requests: 1000 },
};

export function isTestUser(user: User | null | undefined): boolean {
    if (!user?.email) return false;
    return TEST_USER_EMAILS.includes(user.email.toLowerCase());
}

export function parseTestTierOverride(raw: string | null | undefined): TTestTierOverride | null {
    if (raw != null && raw in TEST_TIER_LIMITS) {
        return raw as TTestTierOverride;
    }
    return null;
}

export function getTestTierOverride(): TTestTierOverride | null {
    if (typeof window === "undefined") return null;
    return parseTestTierOverride(localStorage.getItem(TEST_TIER_OVERRIDE_KEY));
}

export function setTestTierOverride(value: TTestTierOverride | null): void {
    if (typeof window === "undefined") return;
    if (value === null) {
        localStorage.removeItem(TEST_TIER_OVERRIDE_KEY);
    } else {
        localStorage.setItem(TEST_TIER_OVERRIDE_KEY, value);
    }
}

export function syncTestTierOverrideToCookie(): void {
    // no-op: server paywall removed
}

function uncappedLimits(userId: string): TFeatureLimits {
    return {
        user_id: userId,
        tier: "uncapped",
        has_active_subscription: true,
        max_monthly_exports: 999999,
        monthly_exports_used: 0,
        remaining_exports: 999999,
        max_monthly_llm_requests: 999999,
        monthly_llm_requests_used: 0,
        remaining_llm_requests: 999999,
        period_start: null,
        resets_on: null,
    };
}

/** Returns uncapped limits. No RPC. */
export const getMyFeatureLimits = async (user: User | undefined | null): Promise<TFeatureLimits | null> => {
    return uncappedLimits(user?.id ?? "");
};
