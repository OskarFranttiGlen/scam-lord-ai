/**
 * @module dashboard-panel
 * Which right-panel tab is showing. Sidebar and the toolbar both set it.
 * Depends on: nothing.
 * Used by: AppSidebar, LandlordHome.
 */

export type TDashboardPanel = "home" | "live" | "settings" | "billing";

const PANELS: readonly TDashboardPanel[] = ["home", "live", "settings", "billing"];

let panel: TDashboardPanel = "home";
const listeners = new Set<() => void>();

export function getDashboardPanel(): TDashboardPanel {
    return panel;
}

export function setDashboardPanel(next: string): void {
    if (!PANELS.includes(next as TDashboardPanel) || next === panel) return;
    panel = next as TDashboardPanel;
    for (const listener of listeners) listener();
}

export function subscribeDashboardPanel(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
