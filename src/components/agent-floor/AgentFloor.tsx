"use client";

/**
 * @module AgentFloor
 * React Flow panel of agent chains. A click opens that agent (ADR 0002 / 02).
 * Depends on: agents, build-floor-graph, AgentView, @xyflow/react.
 * Used by: LandlordHome.
 */

import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { IAgent } from "@/lib/agent-floor/agents";
import { buildFloorGraph } from "./build-floor-graph";
import { AgentView } from "./AgentView";
import { FloorNav } from "./FloorNav";
import {
    FLOOR_MAX_ZOOM,
    FLOOR_MIN_ZOOM,
    FLOOR_NODE_TYPES,
    chainStartViewport,
    markFlash,
} from "./StepNode";

/** Floor of every working agent, or the agent view when one chain is open. */
export function AgentFloor({
    agents,
    openId,
    onOpenChange,
    flash,
}: {
    agents: readonly IAgent[];
    openId: string | null;
    onOpenChange: (id: string | null) => void;
    flash: { id: string; step: string } | null;
}) {
    const selected = openId ? agents.find((agent) => agent.id === openId) : undefined;

    if (agents.length === 0) {
        return <p className="p-6 text-sm text-muted-foreground">No agents.</p>;
    }

    if (selected) {
        return (
            <AgentView
                agent={ selected }
                flash={ flash }
                onBack={ () => onOpenChange(null) }
            />
        );
    }

    const { nodes, edges } = buildFloorGraph(agents);
    const shown = markFlash(nodes, flash);

    return (
        <div className="h-full w-full">
            <ReactFlow
                nodes={ shown }
                edges={ edges }
                nodeTypes={ FLOOR_NODE_TYPES }
                onNodeClick={ (event, node) => {
                    void event;
                    onOpenChange(node.id.split(":")[0] ?? null);
                } }
                defaultViewport={ nodes[0] ? chainStartViewport(nodes[0]) : undefined }
                minZoom={ FLOOR_MIN_ZOOM }
                maxZoom={ FLOOR_MAX_ZOOM }
            >
                <Background />
                <FloorNav />
            </ReactFlow>
        </div>
    );
}
