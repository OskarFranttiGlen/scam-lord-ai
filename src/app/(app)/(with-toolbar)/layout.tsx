/**
 * @module (app)/(with-toolbar)/layout
 *
 * Layout for the builder route at "/dashboard". Sticky toolbar (sm+): breadcrumbs, centered nav, actions.
 *
 * Depends on: Breadcrumbs.
 * Used by: (with-toolbar)/dashboard/page.
 */

import { Breadcrumbs } from "@/components/artifact-builder/shared/Breadcrumbs";
import { ReactNode } from "react";

/**
 * Builder toolbar layout; breadcrumbs, centered nav portal, actions.
 *
 * @param props.children - Builder page content.
 */
export default function ArtifactBuilderLayout({ children }: { children: ReactNode }) {
    return (
        <div className="h-screen max-sm:h-[calc(100dvh-4rem)] flex flex-col overflow-hidden">
            <div className="relative max-sm:hidden shrink-0 z-30 p-2 bg-background border-b border-border flex flex-row items-center gap-2 text-xl text-foreground">
                <div className="min-w-0 flex-1 overflow-hidden">
                    <Breadcrumbs />
                </div>

                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div id="toolbar-nav-portal" className="pointer-events-auto" />
                </div>

                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    <div id="toolbar-actions-portal" />
                </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {children}
            </div>
        </div>
    );
}
