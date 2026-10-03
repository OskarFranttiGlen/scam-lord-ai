"use client";

/**
 * @module ProgramGrid
 * The panel opposite the sidebar chat. Landlord home tabs.
 * Depends on: LandlordHome.
 * Used by: ProgramEditor.
 */

import { memo } from "react";
import { LandlordHome } from "@/components/landlord-home/LandlordHome";

export interface IProps {
    document: TChatArtifactDocument;
    isMobile: boolean;
}

function ProgramGridInner({ document, isMobile }: IProps) {
    void document;
    void isMobile;

    return (
        <div className="h-full min-h-0 flex-1">
            <LandlordHome />
        </div>
    );
}

export const ProgramGrid = memo(ProgramGridInner);
