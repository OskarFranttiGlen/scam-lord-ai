/**
 * @module (app)/layout
 *
 * Root layout for the main app segment. Wraps all (app) routes with fonts,
 * theme, providers (user, sidebar, etc.), and main content area.
 * Navigation is sidebar-only at sm and up; at max-sm a minimal mobile header
 * (sidebar trigger + logo) is shown so the sidebar can be opened as a sheet.
 * Sits at src/app/(app)/layout.tsx; wraps every page under (app).
 *
 * Depends on: global.css, QueryProvider, theme/sidebar/context providers, UserConsentsShell, Analytics, Toaster, MobileSidebarHeader, AppSidebar.
 * Used by: All (app) routes as parent layout.
 */

import "@/styles/global.css";

import { Archivo_Black, Archivo } from "next/font/google";
import QueryProvider from '@/utils/QueryProvider';
import type { Metadata, Viewport } from 'next';
import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppShell } from "@/components/AppShell";
import { Analytics } from "@vercel/analytics/react";
import NextTopLoader from 'nextjs-toploader';
import { PostHogClientProvider } from "@/utils/PostHogClientProvider";
import { UserProvider } from "@/contexts/UserContext";
import { ThemeProvider } from "@/components/theme-provider";
import { DashboardActionsProvider } from "@/contexts/DashboardActionsContext";
import { AgentDebugModeProvider } from "@/contexts/AgentDebugModeContext";
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#B8F2D0" },
    { media: "(prefers-color-scheme: dark)", color: "#10241B" },
  ],
};

export const metadata: Metadata = {
    title: "RentRecovery",
    description: "AI voice agent that calls tenants the day rent goes late.",
    manifest: "/manifest.webmanifest",
    icons: {
        icon: "/app-icon.svg",
        shortcut: "/app-icon.svg",
        apple: "/app-icon.svg",
      },
};

const archivoBlack = Archivo_Black({
    weight: ["400"],
    subsets: ["latin"],
    display: "swap",
    variable: "--font-display",
});

const archivo = Archivo({
    weight: ["400", "600"],
    subsets: ["latin"],
    display: "swap",
    variable: "--font-sans",
});


/**
 * Root layout component. Renders html/body with font classes and provider tree.
 *
 * @param props.children - The active (app) page content.
 */
export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {

    return (
        <html lang="en" className={`${archivoBlack.variable} ${archivo.variable} ${archivo.className}`} suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
(function() {
  try {
    var stored = typeof localStorage !== 'undefined' && localStorage.getItem('theme');
    var dark = stored === 'dark' || (stored !== 'light' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
    var color = dark ? '#10241B' : '#B8F2D0';
    var list = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < list.length; i++) list[i].remove();
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = color;
    document.head.appendChild(meta);
  } catch (e) {}
})();
                        `.trim(),
                    }}
                />
            </head>
            <body>
                <a
                    href="#main"
                    className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-100 focus-visible:rounded focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    Skip to main content
                </a>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                <QueryProvider>
                    <UserProvider>
                        <AgentDebugModeProvider>
                            <SidebarProvider defaultOpen={false}>
                                    <DashboardActionsProvider>
                                    <AppShell>
                                        <main id="main">
                                            <PostHogClientProvider>
                                                <Analytics />
                                                <NextTopLoader
                                                    showSpinner={ false }
                                                    color="#5B2BD9"
                                                />
                                                {children}
                                                <Toaster richColors />
                                            </PostHogClientProvider>
                                        </main>
                                    </AppShell>
                                    </DashboardActionsProvider>
                            </SidebarProvider>
                        </AgentDebugModeProvider>
                    </UserProvider>
                </QueryProvider>
                </ThemeProvider>
            </body>
        </html>
    );
  }
