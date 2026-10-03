/**
 * @module (app)/page
 *
 * Public landing page: logo and login. Route "/".
 */

import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/Logo";
import { DASHBOARD_PATH } from "@/lib/dashboard-url";

export const metadata = {
    title: "RentRecovery",
    description: "Log in to RentRecovery",
};

export default function LandingPage() {
    return (
        <div
            data-auth-frame=""
            className="flex min-h-svh flex-col items-center justify-center gap-8 bg-brand-mint px-4 py-12 text-brand-ink"
        >
            <Logo ground="mint" size="lg" />
            <div className="w-full max-w-md">
                <LoginForm redirectPath={DASHBOARD_PATH} />
            </div>
        </div>
    );
}
