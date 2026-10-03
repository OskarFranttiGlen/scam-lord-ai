/**
 * @module useTypewriterPlaceholder tests
 * Brand strings for the hero chat placeholder (ADR 0033 / 02).
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    PROMPT_OPTIONS,
    STATIC_PREFIX,
    useTypewriterPlaceholder,
} from "../useTypewriterPlaceholder";

describe("useTypewriterPlaceholder brand strings", () => {
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it("uses Ask the agent to as the static prefix with no Andy", () => {
        expect(STATIC_PREFIX).toBe("Ask the agent to ");
        expect(STATIC_PREFIX).not.toMatch(/Andy/i);
        expect(PROMPT_OPTIONS.join(" ")).not.toMatch(/Andy|Hyrox|workout|push pull/i);
    });

    it("returns the Shipworthy prefix once typing starts", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useTypewriterPlaceholder());

        expect(result.current).toBe("Loading...");

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        act(() => {
            vi.advanceTimersByTime(50);
        });

        expect(result.current.startsWith(STATIC_PREFIX)).toBe(true);
        expect(result.current).not.toMatch(/Andy/i);
    });

    it("falls back to Ask the agent to build... when disabled", () => {
        const { result } = renderHook(() =>
            useTypewriterPlaceholder({ enabled: false }),
        );

        expect(result.current).toBe("Ask the agent to build...");
    });
});
