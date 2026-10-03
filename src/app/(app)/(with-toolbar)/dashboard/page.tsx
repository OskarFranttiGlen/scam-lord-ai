/**
 * @module (app)/(with-toolbar)/dashboard/page
 *
 * Builder with chat + agent floor. Wraps Dashboard in Suspense with skeleton
 * fallback. Route "/dashboard".
 *
 * Depends on: DashboardSkeletonSSR, Dashboard.
 * Used by: Next.js (route "/dashboard").
 */

import { DashboardSkeletonSSR } from "@/components/artifact-builder/shared/DashboardSkeletonSSR";
import { Suspense } from "react";
import { Dashboard } from "./Dashboard";

export const metadata = {
    title: "RentRecovery",
    description: "Landlord dashboard and agent floor",
};

/** Builder; bare-arrival redirect lives in Dashboard (client). */
export default function DashboardPage() {
    return (
        <div className="bg-background flex flex-col flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<DashboardSkeletonSSR />}>
                <Dashboard />
            </Suspense>
        </div>
    );
}
