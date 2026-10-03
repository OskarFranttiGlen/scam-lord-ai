"use client";

/**
 * @module AgentFloor
 * React Flow panel of agent chains. A click opens that agent (ADR 0002 / 02).
 * Depends on: agents, build-floor-graph, AgentView, @xyflow/react.
 * Used by: ProgramGrid.
 */

import { useState } from "react";
import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DEFAULT_AGENTS } from "@/lib/agent-floor/agents";
import { buildFloorGraph } from "./build-floor-graph";
import { AgentView } from "./AgentView";
import {
    FLOOR_MAX_ZOOM,
    FLOOR_MIN_ZOOM,
    FLOOR_NODE_TYPES,
    chainStartViewport,
} from "./StepNode";

/** Floor of every working agent, or the agent view when one chain is open. */
export function AgentFloor() {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = DEFAULT_AGENTS.find((agent) => agent.id === selectedId);

    if (selected) {
        return (
            <AgentView
                agent={ selected }
                onBack={ () => setSelectedId(null) }
            />
        );
    }

    const { nodes, edges } = buildFloorGraph(DEFAULT_AGENTS);

    return (
        <div className="h-full w-full">
            <ReactFlow
                nodes={ nodes }
                edges={ edges }
                nodeTypes={ FLOOR_NODE_TYPES }
                onNodeClick={ (event, node) => {
                    void event;
                    const agentId = node.id.split(":")[0];
                    setSelectedId(agentId ?? null);
                } }
                defaultViewport={ nodes[0] ? chainStartViewport(nodes[0]) : undefined }
                minZoom={ FLOOR_MIN_ZOOM }
                maxZoom={ FLOOR_MAX_ZOOM }
            >
                <Background />
            </ReactFlow>
        </div>
    );
}
