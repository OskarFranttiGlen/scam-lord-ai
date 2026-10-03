/**
 * @module (app)/(with-toolbar)/dashboard/page
 *
 * Build-program route. Wraps DashboardClient in Suspense with skeleton
 * fallback. Sits at src/app/(app)/(with-toolbar)/dashboard/page.tsx; route "/dashboard".
 *
 * Depends on: DashboardSkeletonSSR, DashboardClient.
 * Used by: Next.js (route "/dashboard").
 */

import { DashboardSkeletonSSR } from "@/components/artifact-builder/shared/DashboardSkeletonSSR";
import { Suspense } from "react";
import { Dashboard } from "./Dashboard";

export const metadata = {
    title: "Build Program | AI Program Builder",
    description: "Edit your custom program",
};

/** Build-program page; client builder with skeleton fallback. Bare-arrival redirect lives in Dashboard (client). */
export default function DashboardPage() {
    return (
        <div className="bg-white sm:bg-extraLightGray dark:bg-extraDarkGray flex flex-col flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<DashboardSkeletonSSR />}>
                <Dashboard />
            </Suspense>
        </div>
    );
}
