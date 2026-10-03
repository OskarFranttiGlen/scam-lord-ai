/**
 * @module types/database
 *
 * Seam between the Supabase `Database` schema (generated in `src/hooks/supabase.ts`)
 * and the rest of the app. All Supabase-backed types are derived here from
 * `Tables<>`, `Database["public"]["Tables"]`, or RPC return shapes so they stay
 * in sync with the schema.
 *
 * Re-exported as ambient globals via `@types/global.d.ts` during migration;
 * callers can also import directly.
 */
import type { Database, Tables } from "@/hooks/supabase";

// ─── Feature limits (RPC return + anonymous widening) ───────────────────────────

type TFeatureLimitsRpc =
  Database["public"]["Functions"]["get_my_feature_limits"]["Returns"][number];

/**
 * Widened for anonymous users (localStorage-only): they have no subscription
 * and no Usage period - the counter is lifetime, so no reset date may be implied.
 */
export type TFeatureLimits = Omit<
  TFeatureLimitsRpc,
  "has_active_subscription" | "period_start" | "resets_on"
> & {
  has_active_subscription: boolean | null;
  period_start: string | null;
  resets_on: string | null;
};

// ─── Users ──────────────────────────────────────────────────────────────────────

type TUsersRow = Tables<"users">;

export type TUserDetails = {
  first_name: NonNullable<TUsersRow["first_name"]>;
  last_name: NonNullable<TUsersRow["last_name"]>;
  username: NonNullable<TUsersRow["username"]>;
  bio: NonNullable<TUsersRow["bio"]>;
  created_at: TUsersRow["created_at"];
};

// ─── Blog (separate Supabase project - not derived from main Database) ──────────

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

// ─── Followers ──────────────────────────────────────────────────────────────────

/** PostgREST join result: `followers` + `users:follower_id`. */
export type TFollowersRow = {
  follower_id: string | null;
  users: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};

/** PostgREST join result: `followers` + `users:following_id`. */
export type TFollowingRow = {
  following_id: string | null;
  users: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
};
