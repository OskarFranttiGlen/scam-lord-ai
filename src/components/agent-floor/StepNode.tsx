/**
 * @module StepNode
 * Compact React Flow node with left/right ports for the agent floor.
 * Depends on: @xyflow/react, build-floor-graph, utils.
 * Used by: AgentFloor, AgentView.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { IFloorNodeData } from "./build-floor-graph";

/** Marks the node whose step just changed so StepNode can pulse it. */
export function markFlash(
    nodes: Node<IFloorNodeData>[],
    flash: { id: string; step: string } | null,
): Node<IFloorNodeData>[] {
    if (!flash) return nodes;
    const id = `${flash.id}:${flash.step}`;
    return nodes.map((node) => (
        node.id === id
            ? { ...node, data: { ...node.data, flash: true } }
            : node
    ));
}

/** One workflow step box with source/target handles. */
export function StepNode({ data }: NodeProps<Node<IFloorNodeData>>) {
    const flashing = data.flash === true;
    return (
        <div
            aria-current={ data.current ? "step" : undefined }
            className={cn(
                "min-w-[9.5rem] rounded-md border bg-card px-3 py-2 text-left shadow-sm",
                data.current
                    ? "border-2 border-ring font-semibold"
                    : "border-border",
                flashing && "animate-pulse motion-reduce:animate-none",
            )}
        >
            <Handle
                type="target"
                position={Position.Left}
                className="!h-2.5 !w-2.5 !border !border-border !bg-muted-foreground"
            />
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {data.tenant}
            </p>
            <p className="mt-0.5 text-xs text-card-foreground">{data.label}</p>
            { flashing ? (
                <span className="sr-only" aria-live="polite">
                    { data.label } is the current step
                </span>
            ) : null }
            <Handle
                type="source"
                position={Position.Right}
                className="!h-2.5 !w-2.5 !border !border-border !bg-muted-foreground"
            />
        </div>
    );
}

export const FLOOR_NODE_TYPES = {
    step: StepNode,
};

/** Readable default zoom — pan instead of fitView-shrinking the whole chain. */
export const FLOOR_MIN_ZOOM = 1;
export const FLOOR_MAX_ZOOM = 1.5;

/**
 * Viewport with the chain head on the left (fitView centers mid-chain).
 */
export function chainStartViewport(
    first: { position: { x: number; y: number } },
    zoom = FLOOR_MIN_ZOOM,
) {
    return {
        x: 48 - first.position.x * zoom,
        y: 80 - first.position.y * zoom,
        zoom,
    };
}
