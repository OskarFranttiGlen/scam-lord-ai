"use client";

/**
 * @module LandlordHome
 * Right-panel tabs. Home and Live calls are outlets; Settings and Billing are empty.
 * Depends on: tabs, AgentFloor.
 * Used by: ProgramGrid.
 */

import { AgentFloor } from "@/components/agent-floor/AgentFloor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function EmptyTab({ children }: { children: string }) {
    return (
        <p className="p-6 text-sm text-muted-foreground">{ children }</p>
    );
}

/** Home | Live calls | Settings | Billing. Default tab is Home. */
export function LandlordHome() {
    return (
        <Tabs defaultValue="home" className="flex h-full min-h-0 flex-col">
            <TabsList className="mx-3 mt-3 w-fit shrink-0">
                <TabsTrigger value="home">Home</TabsTrigger>
                <TabsTrigger value="live">Live calls</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>
            <TabsContent value="home" data-outlet="home" className="mt-0 min-h-0 flex-1 overflow-auto" />
            <TabsContent value="live" data-outlet="live" className="mt-0 min-h-0 flex-1 overflow-hidden">
                <AgentFloor agents={ [] } />
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
