import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/landlord-home/use-calls", () => ({
    useCalls: () => ({ agents: [], loading: false, error: null, flash: null }),
}));
vi.mock("@/lib/landlord-home/use-home-metrics", () => ({
    useHomeMetrics: () => ({
        collectionRate: null,
        medianResolutionMinutes: null,
        averageTouches: null,
        recovered: null,
        stillOverdue: null,
        promised: null,
        loading: false,
    }),
}));

import { LandlordHome } from "@/components/landlord-home/LandlordHome";
import { setDashboardPanel } from "@/lib/dashboard-panel";

function mockDesktop(matches: boolean) {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
        matches: query === "(min-width: 640px)" ? matches : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe("LandlordHome nav", () => {
    afterEach(() => {
        cleanup();
        setDashboardPanel("home");
        vi.restoreAllMocks();
    });

    it("portals Home and Live calls into the toolbar on desktop", async () => {
        mockDesktop(true);
        const slot = document.createElement("div");
        slot.id = "toolbar-nav-portal";
        document.body.appendChild(slot);

        render(<LandlordHome />);

        await waitFor(() => {
            expect(slot.textContent).toContain("Home");
            expect(slot.textContent).toContain("Live calls");
        });
        expect(slot.textContent).not.toContain("Settings");
        expect(slot.textContent).not.toContain("Billing");
    });

    it("opens Settings and Billing when the sidebar sets the panel", async () => {
        mockDesktop(true);
        const slot = document.createElement("div");
        slot.id = "toolbar-nav-portal";
        document.body.appendChild(slot);

        const view = render(<LandlordHome />);
        setDashboardPanel("settings");
        await waitFor(() => {
            expect(view.getByText("No settings yet.")).toBeTruthy();
        });

        setDashboardPanel("billing");
        await waitFor(() => {
            expect(view.getByText("No billing yet.")).toBeTruthy();
        });
    });
});
