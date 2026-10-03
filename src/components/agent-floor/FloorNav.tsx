"use client";

/**
 * @module FloorNav
 * Left/right buttons to step the viewport along a chain (no scroll).
 * Depends on: @xyflow/react, button.
 * Used by: AgentFloor, AgentView.
 */

import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function useStepAlongChain() {
    const { getViewport, setCenter, getZoom, getNodes } = useReactFlow();
    const width = useStore((s) => s.width);
    const height = useStore((s) => s.height);

    return (dir: -1 | 1) => {
        const nodes = getNodes();
        if (!nodes.length || !width || !height) {
            return;
        }

        const v = getViewport();
        const cx = (width / 2 - v.x) / v.zoom;
        const cy = (height / 2 - v.y) / v.zoom;

        let closest = nodes[0]!;
        let best = Infinity;
        for (const node of nodes) {
            const d =
                (node.position.x - cx) ** 2 + (node.position.y - cy) ** 2;
            if (d < best) {
                best = d;
                closest = node;
            }
        }

        const row = nodes
            .filter((node) => node.position.y === closest.position.y)
            .sort((a, b) => a.position.x - b.position.x);
        const index = row.findIndex((node) => node.id === closest.id);
        const target = row[index + dir];
        if (!target) {
            return;
        }

        const w = target.measured?.width ?? 152;
        const h = target.measured?.height ?? 56;
        void setCenter(
            target.position.x + w / 2,
            target.position.y + h / 2,
            { zoom: getZoom(), duration: 200 },
        );
    };
}

/** Floating prev/next controls on the left and right of the flow. */
export function FloorNav() {
    const step = useStepAlongChain();

    return (
        <>
            <Panel position="center-left" className="!m-3">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="nodrag nopan bg-background/90 shadow-sm"
                    aria-label="Previous step"
                    onClick={ () => step(-1) }
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            </Panel>
            <Panel position="center-right" className="!m-3">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="nodrag nopan bg-background/90 shadow-sm"
                    aria-label="Next step"
                    onClick={ () => step(1) }
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </Panel>
        </>
    );
}
