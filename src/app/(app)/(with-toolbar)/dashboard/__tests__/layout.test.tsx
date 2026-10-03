import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Mock dependencies used by ArtifactBuilderLayout so we only assert its wrapper classes.
vi.mock("@/components/artifact-builder/shared/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/app/(app)/(with-toolbar)/dashboard/Dashboard", () => ({ Dashboard: () => null }));
vi.mock("@/components/artifact-builder/shared/DashboardSkeletonSSR", () => ({
    DashboardSkeletonSSR: () => null,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/components/CustomSidebarTrigger", () => ({ CustomTrigger: () => null }));

import ArtifactBuilderLayout from "@/app/(app)/(with-toolbar)/dashboard/layout";

describe("dashboard layout.tsx", () => {
    afterEach(() => {
        cleanup();
    });

    it("renders sticky toolbar layout with overflow-hidden + mobile viewport height", () => {
        render(<ArtifactBuilderLayout>{null}</ArtifactBuilderLayout>);

        const root = document.querySelector(".overflow-hidden");
        expect(root).toBeTruthy();

        const className = root?.className ?? "";
        expect(className).toContain("overflow-hidden");
        expect(className).toContain("max-sm:h-[calc(100dvh-4rem)]");
        expect(className).toContain("flex-col");
        expect(className).toContain("flex");
    });

    it("keeps title and actions portal targets", () => {
        render(<ArtifactBuilderLayout>{null}</ArtifactBuilderLayout>);

        expect(document.getElementById("toolbar-program-title-portal")).toBeTruthy();
        expect(document.getElementById("toolbar-actions-portal")).toBeTruthy();
    });
});
