"use client";

/**
 * @module ProgramGrid
 * Builds ArtifactGrid props from the Chat artifact document or shows the
 * loading skeleton (ADR 0034 / 04).
 * Depends on: ArtifactGrid, DashboardSkeleton, document-grid.
 * Used by: ProgramEditor.
 */

import { memo } from "react";
import { ArtifactGrid } from "@/components/artifact-builder/day-card/ArtifactGrid";
import { DashboardSkeleton } from "@/components/artifact-builder/shared/DashboardSkeleton";
import { documentWeekCount } from "@/components/artifact-builder/day-card/document-grid";

export interface IProps {
    document: TChatArtifactDocument;
    isMobile: boolean;
}

function ProgramGridInner({ document, isMobile }: IProps) {
    return documentWeekCount(document) > 0 ? (
        <ArtifactGrid
            document={document}
            isMobile={isMobile}
        />
    ) : (
        <DashboardSkeleton />
    );
}

export const ProgramGrid = memo(ProgramGridInner);
