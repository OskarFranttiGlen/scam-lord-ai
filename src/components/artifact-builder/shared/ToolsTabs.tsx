/**
 * @module ToolsTabs
 * Toolbar link "New" with icon; navigates to a fresh dashboard chat.
 * Depends on: none. Used by: dashboard toolbar.
 */
"use client";

import Link from "next/link";
import { SquarePenIcon } from "lucide-react";
import { buildDashboardHref } from "@/lib/dashboard-url";
/** "New" link to start a fresh dashboard chat. */
export const ToolsTabs: React.FC = () => {

    return (
        <>
            <Link href={buildDashboardHref({ empty: true })}>
                <div className="max-sm:hidden cursor-pointer text-sm flex flex-row justify-center items-center gap-2">
                    New
                    <SquarePenIcon size="16" />
                </div>
            </Link>
        </>
    );
};
