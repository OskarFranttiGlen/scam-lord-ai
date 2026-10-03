import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockToast } = vi.hoisted(() => ({
    mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mockToast }));

import { CallNowButton } from "@/components/landlord-home/CallNowButton";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("CallNowButton", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        mockToast.success.mockReset();
        mockToast.error.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("prefills the demo number and rings it", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ defaultPhone: "+61416827278" }))
            .mockResolvedValueOnce(jsonResponse({ roomName: "collect-in_1-abc", phone: "+61416827278" }));

        render(<CallNowButton />);
        fireEvent.click(screen.getByRole("button", { name: "Call now" }));
        const input = await screen.findByLabelText("Phone number");
        await waitFor(() => expect((input as HTMLInputElement).value).toBe("+61416827278"));
        fireEvent.click(screen.getByRole("button", { name: "Call" }));

        await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Calling +61416827278…"));
        expect(fetchMock).toHaveBeenLastCalledWith("/api/calls/demo", expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ phone: "+61416827278" }),
        }));
    });

    it("shows why the call could not be placed", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ defaultPhone: "" }))
            .mockResolvedValueOnce(jsonResponse({ error: "Enter the number in international format, like +61416827278." }, 400));

        render(<CallNowButton />);
        fireEvent.click(screen.getByRole("button", { name: "Call now" }));
        fireEvent.change(await screen.findByLabelText("Phone number"), { target: { value: "0416" } });
        fireEvent.click(screen.getByRole("button", { name: "Call" }));

        await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(
            "Enter the number in international format, like +61416827278.",
        ));
        expect(mockToast.success).not.toHaveBeenCalled();
    });
});
