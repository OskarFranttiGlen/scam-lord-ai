/**
 * @module (app)/(with-toolbar)/dashboard/layout
 *
 * Layout for the builder route. Sticky toolbar (sm+): breadcrumbs + title portal.
 * Fitness set-types / feedback popovers removed (ADR 0034 / 01).
 *
 * Depends on: Breadcrumbs.
 * Used by: dashboard/page.
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
            <div className="max-sm:hidden shrink-0 z-30 p-2 bg-extraLightGray dark:bg-extraDarkGray border-b-2 dark:border-darkGray border-white flex flex-row items-center gap-2 text-xl text-black dark:text-white">
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
            <div className="flex-1 min-h-0 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
