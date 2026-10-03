/**
 * @module RotatingHeroTagline tests
 * Tagline index wrap, word split / assemble duration, and the rotating hero headline.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ASSEMBLE_STAGGER_S,
    ASSEMBLE_WORD_DURATION_S,
    assembleDurationS,
    EXIT_DURATION_S,
    HERO_TAGLINE_HOLD_MS,
    HERO_TAGLINES,
    nextHeroTaglineIndex,
    RotatingHeroTagline,
    splitTaglineWords,
} from "../RotatingHeroTagline";

let reducedMotion = false;

vi.mock("motion/react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("motion/react")>();
    return {
        ...actual,
        useReducedMotion: () => reducedMotion,
    };
});

describe("nextHeroTaglineIndex", () => {
    it("wraps from the last line back to the first", () => {
        expect(nextHeroTaglineIndex(0)).toBe(1);
        expect(nextHeroTaglineIndex(HERO_TAGLINES.length - 1)).toBe(0);
    });
});

describe("splitTaglineWords", () => {
    it("splits on spaces and drops empty segments", () => {
        expect(splitTaglineWords("Chat in. Structured artifact out.")).toEqual([
            "Chat",
            "in.",
            "Structured",
            "artifact",
            "out.",
        ]);
        expect(splitTaglineWords("a  b")).toEqual(["a", "b"]);
        expect(splitTaglineWords("")).toEqual([]);
    });
});

describe("assembleDurationS", () => {
    it("returns zero for an empty line and stagger+duration for words", () => {
        expect(assembleDurationS(0)).toBe(0);
        expect(assembleDurationS(1)).toBe(ASSEMBLE_WORD_DURATION_S);
        expect(assembleDurationS(3)).toBe(
            2 * ASSEMBLE_STAGGER_S + ASSEMBLE_WORD_DURATION_S,
        );
    });
});

describe("RotatingHeroTagline", () => {
    afterEach(() => {
        cleanup();
        reducedMotion = false;
        vi.useRealTimers();
    });

    it("starts on the first tagline and advances the accessible name after hold + exit", () => {
        vi.useFakeTimers();
        render(<RotatingHeroTagline />);

        expect(screen.getByRole("heading", { level: 1 }).getAttribute("aria-label")).toBe(
            HERO_TAGLINES[0],
        );

        act(() => {
            vi.advanceTimersByTime(HERO_TAGLINE_HOLD_MS);
        });

        expect(screen.getByRole("heading", { level: 1 }).getAttribute("aria-label")).toBe(
            HERO_TAGLINES[0],
        );

        act(() => {
            vi.advanceTimersByTime(EXIT_DURATION_S * 1000);
        });

        expect(screen.getByRole("heading", { level: 1 }).getAttribute("aria-label")).toBe(
            HERO_TAGLINES[1],
        );
    });

    it("stays on the first tagline when the visitor prefers reduced motion", () => {
        reducedMotion = true;
        vi.useFakeTimers();
        render(<RotatingHeroTagline />);

        act(() => {
            vi.advanceTimersByTime(HERO_TAGLINE_HOLD_MS * 2);
        });

        expect(screen.getByRole("heading", { level: 1 }).getAttribute("aria-label")).toBe(
            HERO_TAGLINES[0],
        );
        expect(screen.getByTestId("hero-tagline").getAttribute("data-text")).toBe(
            HERO_TAGLINES[0],
        );
    });
});
