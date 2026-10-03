"use client";

import { memo } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";

export interface IProps {
    sidebarPosition: "left" | "right";
    sidebarPanelRef: React.RefObject<ImperativePanelHandle | null>;
    sidebarSize: number;
    onSidebarResize: (size: number) => void;
    isChatHidden: boolean;
    chatPanel: React.ReactNode;
    routineContent: React.ReactNode;
    maxSidebarSize: number;
}

const SIDEBAR_PANEL_CLASS =
    "border-border bg-background overflow-hidden";
const MAIN_PANEL_CLASS = "bg-background";

function DashboardDesktopLayoutInner({
    sidebarPosition,
    sidebarPanelRef,
    sidebarSize,
    onSidebarResize,
    isChatHidden,
    chatPanel,
    routineContent,
    maxSidebarSize,
}: IProps) {
    const sidebarPanel = (
        <ResizablePanel
            ref={sidebarPanelRef}
            id="sidebar"
            order={sidebarPosition === "left" ? 1 : 2}
            defaultSize={sidebarSize}
            onResize={onSidebarResize}
            minSize={0}
            maxSize={maxSidebarSize}
            collapsible
            className={SIDEBAR_PANEL_CLASS}
        >
            {chatPanel}
        </ResizablePanel>
    );

    const mainPanel = (
        <ResizablePanel
            id="main-content"
            order={sidebarPosition === "left" ? 2 : 1}
            minSize={0}
            className={MAIN_PANEL_CLASS}
        >
            <div className="sm:pl-8 w-full max-w-full max-sm:overflow-x-hidden h-full flex flex-col">
                {routineContent}
            </div>
        </ResizablePanel>
    );

    const handle = !isChatHidden ? <ResizableHandle withHandle className="" /> : null;

    return (
        <div className="max-sm:hidden sm:flex sm:min-h-0 sm:flex-1 sm:flex-col">
            <ResizablePanelGroup direction="horizontal">
                {sidebarPosition === "left" ? (
                    <>
                        {sidebarPanel}
                        {handle}
                        {mainPanel}
                    </>
                ) : (
                    <>
                        {mainPanel}
                        {handle}
                        {sidebarPanel}
                    </>
                )}
            </ResizablePanelGroup>
        </div>
    );
}

export const DashboardDesktopLayout = memo(DashboardDesktopLayoutInner);
