"use client";

/**
 * @module LandlordHome
 * Right-panel tabs. Home and Live calls are outlets; Settings and Billing are empty.
 * On sm+, Home and Live calls (with the Call now action) portal into #toolbar-nav-portal.
 * Settings and Billing are opened from the sidebar.
 * Depends on: tabs, AgentFloor, CallNowButton, home panels, dashboard-panel.
 * Used by: ProgramGrid.
 */

import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AgentFloor } from "@/components/agent-floor/AgentFloor";
import { ActivityFeed } from "@/components/landlord-home/ActivityFeed";
import { CallNowButton } from "@/components/landlord-home/CallNowButton";
import { Funnel } from "@/components/landlord-home/Funnel";
import { MetricsBand } from "@/components/landlord-home/MetricsBand";
import { NeedsYou } from "@/components/landlord-home/NeedsYou";
import { activity, funnel, needsYou } from "@/lib/landlord-home/home-derived";
import { useCalls } from "@/lib/landlord-home/use-calls";
import { useHomeMetrics } from "@/lib/landlord-home/use-home-metrics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDashboardPanel, setDashboardPanel, subscribeDashboardPanel } from "@/lib/dashboard-panel";
import { cn } from "@/lib/utils";

function HomeNav({ className }: { className?: string }) {
    return (
        <div className={ cn("flex items-center gap-2", className) }>
            <TabsList>
                <TabsTrigger value="home">Home</TabsTrigger>
                <TabsTrigger value="live">Live calls</TabsTrigger>
            </TabsList>
            <CallNowButton />
        </div>
    );
}

function EmptyTab({ children }: { children: string }) {
    return (
        <p className="p-6 text-sm text-muted-foreground">{ children }</p>
    );
}

/** Home | Live calls in the toolbar. Settings and Billing from the sidebar. Default is Home. */
export function LandlordHome() {
    const { agents, loading, error, flash } = useCalls();
    const metrics = useHomeMetrics();
    const tab = useSyncExternalStore(subscribeDashboardPanel, getDashboardPanel, getDashboardPanel);
    const [openId, setOpenId] = useState<string | null>(null);
    const [navSlot, setNavSlot] = useState<HTMLElement | null>(null);

    useLayoutEffect(() => {
        const mq = window.matchMedia("(min-width: 640px)");
        const sync = () => {
            const next = mq.matches ? document.getElementById("toolbar-nav-portal") : null;
            queueMicrotask(() => setNavSlot(next));
        };
        sync();
        mq.addEventListener("change", sync);
        return () => mq.removeEventListener("change", sync);
    }, []);

    return (
        <Tabs value={ tab } onValueChange={ setDashboardPanel } className="flex h-full min-h-0 flex-col">
            { navSlot
                ? createPortal(<HomeNav />, navSlot)
                : <HomeNav className="mx-3 mt-3 w-fit shrink-0 sm:hidden" /> }
            <TabsContent value="home" data-outlet="home" className="mt-0 min-h-0 flex-1 overflow-auto">
                { error ? (
                    <EmptyTab>Couldn&apos;t load calls.</EmptyTab>
                ) : loading || metrics.loading ? null : (
                    <div className="flex min-w-0 flex-col gap-8 p-6">
                        <MetricsBand
                            collectionRate={ metrics.collectionRate }
                            medianResolutionMinutes={ metrics.medianResolutionMinutes }
                            averageTouches={ metrics.averageTouches }
                            recovered={ metrics.recovered }
                            stillOverdue={ metrics.stillOverdue }
                            promised={ metrics.promised }
                        />
                        <NeedsYou
                            items={ needsYou(agents) }
                            onOpenAgent={ (id) => {
                                setOpenId(id);
                                setDashboardPanel("live");
                            } }
                        />
                        <Funnel counts={ funnel(agents) } />
                        <ActivityFeed items={ activity(agents) } />
                    </div>
                ) }
            </TabsContent>
            <TabsContent value="live" data-outlet="live" className="mt-0 min-h-0 flex-1 overflow-hidden">
                {error ? (
                    <EmptyTab>Couldn&apos;t load calls.</EmptyTab>
                ) : loading ? null : (
                    <AgentFloor
                        agents={ agents }
                        openId={ openId }
                        onOpenChange={ setOpenId }
                        flash={ flash }
                    />
                )}
            </TabsContent>
            <TabsContent value="settings" className="mt-0 min-h-0 flex-1">
                <EmptyTab>No settings yet.</EmptyTab>
            </TabsContent>
            <TabsContent value="billing" className="mt-0 min-h-0 flex-1">
                <EmptyTab>No billing yet.</EmptyTab>
            </TabsContent>
        </Tabs>
    );
}
