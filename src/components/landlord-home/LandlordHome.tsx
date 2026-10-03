"use client";

/**
 * @module LandlordHome
 * Right-panel tabs. Home and Live calls are outlets; Settings and Billing are empty.
 * Depends on: tabs, AgentFloor, home panels.
 * Used by: ProgramGrid.
 */

import { AgentFloor } from "@/components/agent-floor/AgentFloor";
import { ActivityFeed } from "@/components/landlord-home/ActivityFeed";
import { Funnel } from "@/components/landlord-home/Funnel";
import { MetricsBand } from "@/components/landlord-home/MetricsBand";
import { NeedsYou } from "@/components/landlord-home/NeedsYou";
import { activity, funnel, needsYou } from "@/lib/landlord-home/home-derived";
import { useCalls } from "@/lib/landlord-home/use-calls";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function EmptyTab({ children }: { children: string }) {
    return (
        <p className="p-6 text-sm text-muted-foreground">{ children }</p>
    );
}

/** Home | Live calls | Settings | Billing. Default tab is Home. */
export function LandlordHome() {
    const { agents, loading, error } = useCalls();

    return (
        <Tabs defaultValue="home" className="flex h-full min-h-0 flex-col">
            <TabsList className="mx-3 mt-3 w-fit shrink-0">
                <TabsTrigger value="home">Home</TabsTrigger>
                <TabsTrigger value="live">Live calls</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>
            <TabsContent value="home" data-outlet="home" className="mt-0 min-h-0 flex-1 overflow-auto">
                { error ? (
                    <EmptyTab>Couldn&apos;t load calls.</EmptyTab>
                ) : loading ? null : (
                    <div className="flex min-w-0 flex-col gap-8 p-6">
                        <MetricsBand />
                        <NeedsYou items={ needsYou(agents) } />
                        <Funnel counts={ funnel(agents) } />
                        <ActivityFeed items={ activity(agents) } />
                    </div>
                ) }
            </TabsContent>
            <TabsContent value="live" data-outlet="live" className="mt-0 min-h-0 flex-1 overflow-hidden">
                {error ? (
                    <EmptyTab>Couldn&apos;t load calls.</EmptyTab>
                ) : loading ? null : (
                    <AgentFloor agents={ agents } />
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
