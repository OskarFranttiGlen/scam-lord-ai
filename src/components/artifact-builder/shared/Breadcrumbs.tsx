/**
 * @module Breadcrumbs
 * Hollow breadcrumb trail for the builder dual-pane (ADR 0034 / 01).
 * Depends on: ui/breadcrumb.
 * Used by: (with-toolbar) layout / toolbar.
 */
"use client";

import { usePathname } from "next/navigation";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buildDashboardHref } from "@/lib/dashboard-url";

export const Breadcrumbs: React.FC = () => {
    const pathname = usePathname();
    const isBuilder =
        pathname?.startsWith("/dashboard") === true;

    return (
        <Breadcrumb className="w-full max-sm:hidden">
            <BreadcrumbList>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    {isBuilder ? (
                        <BreadcrumbLink href={buildDashboardHref({ resume: true })}>
                            Dashboard
                        </BreadcrumbLink>
                    ) : (
                        <BreadcrumbLink href="/">Home</BreadcrumbLink>
                    )}
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    );
};
