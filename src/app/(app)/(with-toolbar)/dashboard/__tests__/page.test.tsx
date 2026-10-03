import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/components/artifact-builder/shared/DashboardSkeletonSSR", () => ({
    DashboardSkeletonSSR: () => null,
}));
vi.mock("@/app/(app)/(with-toolbar)/dashboard/Dashboard", () => ({
    Dashboard: () => null,
}));

import DashboardPage from "@/app/(app)/(with-toolbar)/dashboard/page";

describe("dashboard page.tsx", () => {
    it("wraps the page with min-h-0 and overflow-hidden to prevent double scroll", () => {
        render(<DashboardPage />);

        const wrapper = document.querySelector(".min-h-0");
        expect(wrapper).toBeTruthy();

        const className = wrapper?.className ?? "";
        expect(className).toContain("min-h-0");
        expect(className).toContain("overflow-hidden");
        expect(className).toContain("flex-1");
        expect(className).toContain("flex");
        expect(className).toContain("flex-col");
    });
});

