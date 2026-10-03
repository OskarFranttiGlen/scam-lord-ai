import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/landlord-home/use-calls", () => ({
    useCalls: () => ({ agents: [], loading: false, error: null, flash: null }),
}));
vi.mock("@/lib/landlord-home/use-home-metrics", () => ({
    useHomeMetrics: () => ({
        recovered: null,
        stillOverdue: null,
        promised: null,
        medianMinutes: null,
        loading: false,
    }),
}));

import { LandlordHome } from "@/components/landlord-home/LandlordHome";

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
        vi.restoreAllMocks();
    });

    it("portals Home, Live calls, Settings, and Billing into the toolbar on desktop", async () => {
        mockDesktop(true);
        const slot = document.createElement("div");
        slot.id = "toolbar-nav-portal";
        document.body.appendChild(slot);

        render(<LandlordHome />);

        await waitFor(() => {
            expect(slot.textContent).toContain("Home");
            expect(slot.textContent).toContain("Live calls");
            expect(slot.textContent).toContain("Settings");
            expect(slot.textContent).toContain("Billing");
        });
    });
});
