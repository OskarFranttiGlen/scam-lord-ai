"use client";

/**
 * @module ProgramEditor
 * Editor shell: passes the Chat artifact document into ProgramGrid (ADR 0034 / 04).
 * Depends on: ProgramGrid.
 * Used by: Dashboard.
 */

import { memo } from "react";
import { ProgramGrid } from "./ProgramGrid";

interface IProps {
    document: TChatArtifactDocument;
    isMobile: boolean;
}

function ProgramEditorInner(props: IProps) {
    const { document, isMobile } = props;

    return (
        <ProgramGrid
            document={document}
            isMobile={isMobile}
        />
    );
}

export const ProgramEditor = memo(ProgramEditorInner);
