/**
 * @module (app)/auth/layout
 *
 * Brand-mint frame for login, sign-up, and password routes.
 * Sits at src/app/(app)/auth/layout.tsx; wraps all /auth/* routes.
 */

import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Login or Signup",
  description: "Login or signup to your RentRecovery account",
};

/**
 * Auth segment layout; mint ground, logo, then the form.
 *
 * @param props.children - The active auth page (e.g. login, sign-up).
 */
export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
      <div data-auth-frame="" className="flex min-h-svh flex-col items-center justify-center gap-8 bg-brand-mint px-4 py-12 text-brand-ink">
        <Logo ground="mint" size="lg" />
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>
  )
}
