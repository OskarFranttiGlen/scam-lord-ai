/**
 * @module dashboard-url
 * Builder URL helpers for chat mint / resume / search strip (ADR 0034 / 01).
 * Depends on: next/navigation.
 * Used by: sign-in-return, PromptTemplate, chat-history, use-dashboard-chat.
 */

import type { ReadonlyURLSearchParams } from "next/navigation";

export const DASHBOARD_PATH = "/dashboard";

type TSearchParamsLike =
    | ReadonlyURLSearchParams
    | URLSearchParams
    | { get(name: string): string | null; toString(): string };

type TRouterLike = {
    replace: (href: string) => void;
};

interface IBuildDashboardHrefOptions {
    chatId?: string;
    search?: string;
    resume?: boolean;
    empty?: boolean;
}

interface IMintUrlOptions {
    stripSearch?: boolean;
}

/**
 * Build a builder href with optional chat / search / resume query params.
 */
export function buildDashboardHref(
    options: IBuildDashboardHrefOptions = {},
): string {
    const params = new URLSearchParams();
    if (options.chatId) params.set("chat", options.chatId);
    if (options.search) params.set("search", options.search);
    if (options.resume) params.set("resume", "true");
    if (options.empty) params.set("empty", "true");
    const qs = params.toString();
    return qs ? `${DASHBOARD_PATH}?${qs}` : DASHBOARD_PATH;
}

/**
 * Force `resume=true` on a builder return URL while keeping other params.
 * Lone `empty=true` is dropped (sign-in return tests).
 */
export function resolveDashboardReturnHref(qs: string): string {
    const params = new URLSearchParams(qs.replace(/^\?/, ""));
    if (params.get("empty") === "true" && [...params.keys()].length === 1) {
        params.delete("empty");
    }
    params.set("resume", "true");
    const next = params.toString();
    return `${DASHBOARD_PATH}?${next}`;
}

function cloneParams(searchParams: TSearchParamsLike): URLSearchParams {
    return new URLSearchParams(searchParams.toString());
}

/**
 * Replace URL with minted `chat` id (and optionally strip `search`).
 */
export function applyDashboardMintUrlUpdate(
    router: TRouterLike,
    pathname: string | null,
    searchParams: TSearchParamsLike,
    chatId: string,
    options: IMintUrlOptions = {},
): void {
    if (!pathname || pathname !== DASHBOARD_PATH) return;
    const params = cloneParams(searchParams);
    params.set("chat", chatId);
    if (options.stripSearch) {
        params.delete("search");
    }
    const qs = params.toString();
    router.replace(qs ? `${DASHBOARD_PATH}?${qs}` : DASHBOARD_PATH);
}

/**
 * Drop the `search` query param from the builder URL.
 */
export function stripSearchFromDashboardUrl(
    router: TRouterLike,
    pathname: string | null,
    searchParams: TSearchParamsLike,
): void {
    if (!pathname || pathname !== DASHBOARD_PATH) return;
    const params = cloneParams(searchParams);
    if (!params.has("search")) return;
    params.delete("search");
    const qs = params.toString();
    router.replace(qs ? `${DASHBOARD_PATH}?${qs}` : DASHBOARD_PATH);
}
