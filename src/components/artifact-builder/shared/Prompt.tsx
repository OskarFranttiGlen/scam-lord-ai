"use client";
/**
 * @module Prompt
 * Landing hero: title, subtitle, prompt input, product preview, and gradient backdrop.
 * Syncs SSR user into UserContext.
 * Depends on: PromptTemplate, ResumeDraftBanner, UserContext, RotatingHeroTagline. Used by: dashboard/landing.
 */
import { useEffect } from "react";
import { RotatingHeroTagline } from "@/components/landing/RotatingHeroTagline";
import { useUserContext } from "@/contexts/UserContext";
import { User } from "@supabase/supabase-js";
import { PromptTemplate } from "./PromptTemplate";
import { ResumeDraftBanner } from "../ResumeDraftBanner";
import posthog from "posthog-js";
import { motion, useReducedMotion } from "motion/react";

/** Props for the landing prompt section. */
interface IProps {
    /** User from server (e.g. session); synced into UserContext on mount. */
    userData: User | null;
}

/** Landing hero with prompt input; sets UserContext from userData. */
export const Prompt: React.FC<IProps> = ({ userData }) => {
    const { setUser } = useUserContext();
    const reduceMotion = useReducedMotion();

    // DO NOT TOUCH THIS -- SETS REACT CONTEXT FOR USERS THAT SIGNED IN WITH AN SSR METHOD
    useEffect(() => {
        if (userData) {
            setUser(userData);
        }

        posthog?.capture?.('page_view', { page: '/', user: userData?.id ?? "user_id_unknown" });

    }, [userData, setUser]);

    return (
        <>
            {/* min-h-screen + safe-area padding (not h-screen/100vh) to avoid hero text shifting on mobile PWAs and in-app browsers when shell resizes */}
            <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-[#e8eef3] pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] dark:bg-background">
                <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
                    <div className="absolute inset-0 dark:hidden">
                        <div className="absolute left-1/2 top-[40%] z-0 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2 rounded-full hero__atmosphere" />
                        <div className="absolute right-[-5%] top-[10%] z-0 h-[50%] w-[50%] rounded-full hero__atmosphere_secondary" />
                        <div className="absolute left-[-8%] bottom-[6%] z-0 h-[40%] w-[40%] rounded-full hero__atmosphere_secondary" />
                    </div>
                    <div className="absolute inset-0 hidden dark:block">
                        <div className="absolute left-1/2 top-[42%] z-0 h-[65%] w-[65%] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-full hero__atmosphere_dark" />
                        <div className="absolute right-[-5%] top-[12%] z-0 h-[45%] w-[45%] rounded-full hero__atmosphere_secondary opacity-40" />
                        <div className="absolute left-[-6%] bottom-[8%] z-0 h-[35%] w-[35%] rounded-full hero__atmosphere_secondary opacity-30" />
                    </div>
                    <div className="absolute inset-0 bg-linear-to-b from-white/40 via-transparent to-[#dce5ee] dark:from-background/25 dark:via-transparent dark:to-background/35" />
                    <div className="absolute inset-0 hero__vignette" />
                </div>
                <div className="relative z-20 hidden w-full shrink-0 justify-center sm:flex">
                    <span className="font-tertiary text-2xl font-bold tracking-tight text-foreground">
                        Shipworthy
                    </span>
                </div>

                {/* CTA centers in space above product slot - same flex budget as before. */}
                <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center px-0 py-6">
                    <div className="flex w-full flex-col items-center gap-6 sm:gap-8">
                        <motion.div
                            className="flex flex-col items-center gap-3 text-center"
                            initial={reduceMotion ? false : { opacity: 0, y: 28 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.85, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <RotatingHeroTagline />
                            <div className="px-12 text-center text-xl font-normal leading-tight text-muted-foreground max-sm:px-2 max-sm:text-base">
                                <span className="block">Chat that builds a structured artifact.</span>
                            </div>
                        </motion.div>
                        <motion.div
                            className="flex w-full max-w-3xl max-sm:px-2 flex-col items-center gap-3"
                            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.85, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <ResumeDraftBanner />
                            <PromptTemplate />
                        </motion.div>
                    </div>
                </div>
            </div>
        </>
    );
};
