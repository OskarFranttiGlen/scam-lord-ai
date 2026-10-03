"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppSidebarDynamic } from "@/components/AppSidebarDynamic";
import { MobileSidebarHeader } from "@/components/header/MobileSidebarHeader";

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isAuth = pathname === "/" || pathname.startsWith("/auth");

    return (
        <>
            {isAuth ? null : <AppSidebarDynamic />}
            <div className={isAuth ? "min-w-0 flex-1" : "flex-1 min-w-0 bg-background"}>
                {isAuth ? null : <MobileSidebarHeader />}
                {children}
            </div>
        </>
    );
}
