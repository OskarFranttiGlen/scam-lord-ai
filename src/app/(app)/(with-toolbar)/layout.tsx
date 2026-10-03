/**
 * @module (app)/(with-toolbar)/layout
 *
 * Layout for the builder route at "/dashboard". Sticky toolbar (sm+): breadcrumbs + title portal.
 *
 * Depends on: Breadcrumbs.
 * Used by: (with-toolbar)/dashboard/page.
 */

import { Breadcrumbs } from "@/components/artifact-builder/shared/Breadcrumbs";
import { ReactNode } from "react";

/**
 * Builder toolbar layout; breadcrumbs and title portal.
 *
 * @param props.children - Builder page content.
 */
export default function ArtifactBuilderLayout({ children }: { children: ReactNode }) {
    return (
        <div className="h-screen max-sm:h-[calc(100dvh-4rem)] flex flex-col overflow-hidden">
            <div className="max-sm:hidden shrink-0 z-30 p-2 bg-background border-b border-border flex flex-row items-center gap-2 text-xl text-foreground">
                <div className="min-w-0 flex-1 overflow-hidden">
                    <Breadcrumbs />
                </div>

                <div className="flex min-w-0 flex-[1.1] justify-center px-2">
                    <div id="toolbar-program-title-portal" className="flex w-fit min-w-0 max-w-[20ch] justify-center" />
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
