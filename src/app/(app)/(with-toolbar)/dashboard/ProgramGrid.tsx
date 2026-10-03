"use client";

/**
 * @module ProgramGrid
 * The panel opposite the sidebar chat. Renders the agent floor (ADR 0002 / 02).
 * Depends on: AgentFloor.
 * Used by: ProgramEditor.
 */

import { memo } from "react";
import { AgentFloor } from "@/components/agent-floor/AgentFloor";

export interface IProps {
    document: TChatArtifactDocument;
    isMobile: boolean;
}

function ProgramGridInner({ document, isMobile }: IProps) {
    void document;
    void isMobile;

    return (
        <div className="h-full min-h-0 flex-1">
            <AgentFloor />
        </div>
    );
}

export const ProgramGrid = memo(ProgramGridInner);
