/**
 * @module Breadcrumbs
 * Hollow breadcrumb trail for the dashboard dual-pane (ADR 0034 / 01).
 * Depends on: ui/breadcrumb.
 * Used by: dashboard layout / toolbar.
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

export const Breadcrumbs: React.FC = () => {
    const segments = usePathname().split("/").filter(Boolean);
    const isBuilder =
        segments.includes("dashboard") || segments.includes("dashboard");

    return (
        <Breadcrumb className="w-full max-sm:hidden">
            <BreadcrumbList>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                    <BreadcrumbLink href="/">Home</BreadcrumbLink>
                </BreadcrumbItem>
                {isBuilder ? (
                    <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbLink href="/dashboard?resume=true">
                                Dashboard
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                    </>
                ) : null}
            </BreadcrumbList>
        </Breadcrumb>
    );
};
