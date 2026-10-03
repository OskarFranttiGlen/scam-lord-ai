"use client";

/**
 * @module MobileSidebarHeader
 * Minimal header shown only at max-sm: sidebar trigger and logo. Lets users open
 * the sidebar sheet on small viewports when the persistent sidebar is hidden.
 * On dashboard route, shows the Save portal (Sign in to save when anonymous).
 * Depends on: CustomSidebarTrigger, SidebarProvider (useSidebar).
 * Used by: (app) layout.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CustomTrigger } from "@/components/CustomSidebarTrigger";

export function MobileSidebarHeader() {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard") ?? false;

  return (
    <header
      data-proxima-mobile-header=""
      className="sm:hidden w-full flex py-2 justify-between items-center bg-white dark:bg-darkGray sticky top-0 z-50 px-2"
      role="banner"
    >
      <CustomTrigger />
      <Link href="/" className="absolute left-1/2 -translate-x-1/2" aria-label="Shipworthy home">
        <span className="font-tertiary text-lg font-bold tracking-tight text-foreground">
          Shipworthy
        </span>
      </Link>
      {isDashboard ? (
        <div id="toolbar-save-portal-mobile" className="empty:hidden" />
      ) : (
        <div className="w-10" aria-hidden />
      )}
    </header>
  );
}
