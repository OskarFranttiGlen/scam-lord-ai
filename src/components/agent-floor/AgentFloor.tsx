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
                onNodeClick={ (event, node) => {
                    void event;
                    const agentId = node.id.split(":")[0];
                    setSelectedId(agentId ?? null);
                } }
                fitView
            >
                <Background />
            </ReactFlow>
        </div>
    );
}
