"use client";

/**
 * @module RotatingHeroTagline
 * Homepage hero headline. Cycles generic ScamLord template lines with a
 * clip-masked word assemble (blur settle) and a soft line exit handoff.
 * Used by: Prompt. Depends on: motion/react.
 */

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";

export const HERO_TAGLINES = [
    "Describe it. The agent builds it.",
    "Chat in. Structured artifact out.",
    "Edit the grid from conversation.",
    "From prompt to day-by-day structure.",
] as const;

export const HERO_TAGLINE_HOLD_MS = 5000;

/** Delay between consecutive words starting their assemble. */
export const ASSEMBLE_STAGGER_S = 0.09;
/** Per-word clip-rise / blur duration. */
export const ASSEMBLE_WORD_DURATION_S = 0.6;
/** Enter blur amount in px before the word settles. */
export const ASSEMBLE_BLUR_PX = 6;
/** Whole-line exit dissolve duration. */
export const EXIT_DURATION_S = 0.32;
/** Exit blur amount in px. */
export const EXIT_BLUR_PX = 5;

const HEADING_CLASS =
    "grid w-full px-4 text-center font-tertiary text-6xl font-bold leading-[1.08] tracking-tight text-foreground max-sm:px-6 max-sm:text-4xl dark:drop-shadow-[0_0_22px_rgba(51,187,207,0.28)]";

const ASSEMBLE_EASE = [0.16, 1, 0.3, 1] as const;
const EXIT_EASE = [0.4, 0, 1, 1] as const;
const EXIT_DURATION_MS = EXIT_DURATION_S * 1000;

const lineVariants: Variants = {
    hidden: {},
    visible: {
        transition: {
            staggerChildren: ASSEMBLE_STAGGER_S,
        },
    },
};

const wordVariants: Variants = {
    hidden: {
        y: "110%",
        opacity: 0,
        filter: `blur(${ASSEMBLE_BLUR_PX}px)`,
    },
    visible: {
        y: "0%",
        opacity: 1,
        filter: "blur(0px)",
        transition: {
            duration: ASSEMBLE_WORD_DURATION_S,
            ease: ASSEMBLE_EASE,
        },
    },
};

/** Advance through HERO_TAGLINES, wrapping to 0. */
export function nextHeroTaglineIndex(index: number): number {
    return (index + 1) % HERO_TAGLINES.length;
}

/** Split a tagline into words on spaces. Empty segments are dropped. */
export function splitTaglineWords(text: string): string[] {
    return text.split(" ").filter((word) => word.length > 0);
}

/**
 * Seconds until the last word finishes assembling.
 *
 * @param wordCount - Number of words in the tagline.
 */
export function assembleDurationS(wordCount: number): number {
    if (wordCount === 0) {
        return 0;
    }
    return (wordCount - 1) * ASSEMBLE_STAGGER_S + ASSEMBLE_WORD_DURATION_S;
}

function TaglineSizers() {
    return (
        <>
            { HERO_TAGLINES.map((line) => (
                <span
                    key={ line }
                    aria-hidden
                    className="invisible col-start-1 row-start-1"
                >
                    { line }
                </span>
            )) }
        </>
    );
}

interface IAssembleLineProps {
    /** When false, skip the enter animation (first paint). */
    animateEnter: boolean;
    text: string;
}

/**
 * One tagline's words. Remount with a new key only after the exit fade finishes
 * so the settled line is never swapped for a fresh full-opacity copy.
 */
function AssembleLine({ animateEnter, text }: IAssembleLineProps) {
    const words = splitTaglineWords(text);

    return (
        <motion.span
            data-testid="hero-tagline"
            data-text={ text }
            className="inline-block"
            initial={ animateEnter ? "hidden" : false }
            animate="visible"
            variants={ lineVariants }
        >
            { words.map((word, i) => (
                <span
                    key={ i }
                    className="inline-block overflow-hidden align-bottom pb-[0.12em] -mb-[0.12em]"
                >
                    <motion.span
                        className="inline-block whitespace-nowrap will-change-[transform,filter,opacity]"
                        variants={ wordVariants }
                    >
                        { word }
                        { i < words.length - 1 ? "\u00a0" : null }
                    </motion.span>
                </span>
            )) }
        </motion.span>
    );
}

/**
 * Landing h1 that rotates HERO_TAGLINES. Height is reserved with stacked
 * invisible copies so the prompt below does not jump.
 */
export function RotatingHeroTagline() {
    const reduceMotion = Boolean(useReducedMotion());
    const [index, setIndex] = useState(0);
    const [cycleCount, setCycleCount] = useState(0);
    const [isExiting, setIsExiting] = useState(false);
    const isExitingRef = useRef(false);
    const active = HERO_TAGLINES[index];

    // Clock subscription: start an exit fade on a timer, not a user event.
    useEffect(() => {
        if (reduceMotion) {
            return;
        }
        const id = window.setInterval(() => {
            if (isExitingRef.current) {
                return;
            }
            isExitingRef.current = true;
            setIsExiting(true);
        }, HERO_TAGLINE_HOLD_MS);
        return () => {
            window.clearInterval(id);
        };
    }, [reduceMotion]);

    // Advance to the next line only after the exit fade has finished.
    useEffect(() => {
        if (!isExiting) {
            return;
        }
        const id = window.setTimeout(() => {
            setIndex((current) => nextHeroTaglineIndex(current));
            setCycleCount((count) => count + 1);
            setIsExiting(false);
            isExitingRef.current = false;
        }, EXIT_DURATION_MS);
        return () => {
            window.clearTimeout(id);
        };
    }, [isExiting]);

    return (
        <h1
            className={ HEADING_CLASS }
            aria-label={ active }
        >
            <TaglineSizers />
            <span
                className="relative col-start-1 row-start-1 overflow-x-clip"
                aria-hidden
            >
                { reduceMotion ? (
                    <span
                        data-testid="hero-tagline"
                        data-text={ active }
                    >
                        { active }
                    </span>
                ) : (
                    <motion.span
                        className="inline-block will-change-[opacity,filter]"
                        initial={ false }
                        animate={
                            isExiting
                                ? {
                                    opacity: 0,
                                    filter: `blur(${EXIT_BLUR_PX}px)`,
                                }
                                : {
                                    opacity: 1,
                                    filter: "blur(0px)",
                                }
                        }
                        transition={
                            isExiting
                                ? {
                                    duration: EXIT_DURATION_S,
                                    ease: EXIT_EASE,
                                }
                                : { duration: 0 }
                        }
                    >
                        <AssembleLine
                            key={ cycleCount }
                            animateEnter={ cycleCount > 0 }
                            text={ active }
                        />
                    </motion.span>
                ) }
            </span>
        </h1>
    );
}
