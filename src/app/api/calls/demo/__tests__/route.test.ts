/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetUser, mockPlaceDemoCall } = vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockPlaceDemoCall: vi.fn(),
}));

vi.mock("@/utils/supabase/server", () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: mockGetUser },
    })),
}));

vi.mock("@/voice/demo-call", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/voice/demo-call")>()),
    placeDemoCall: mockPlaceDemoCall,
}));

import { GET, POST } from "../route";

function post(body: unknown) {
    return POST(new Request("http://localhost/api/calls/demo", { method: "POST", body: JSON.stringify(body) }));
}

describe("/api/calls/demo", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("DEMO_TENANT_PHONE", "+61400000000");
        mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
        mockPlaceDemoCall.mockResolvedValue({ roomName: "collect-in_1-abc" });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("refuses to dial when signed out", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

        const response = await post({ phone: "+61416827278" });

        expect(response.status).toBe(401);
        expect(mockPlaceDemoCall).not.toHaveBeenCalled();
    });

    it("rejects a number that is not in international format", async () => {
        const response = await post({ phone: "0416 827 278" });

        expect(response.status).toBe(400);
        expect(mockPlaceDemoCall).not.toHaveBeenCalled();
    });

    it("dials the demo call to the given number and returns the room", async () => {
        const response = await post({ phone: " +61416827278 " });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ roomName: "collect-in_1-abc", phone: "+61416827278" });
        expect(mockPlaceDemoCall).toHaveBeenCalledWith({ toPhoneNumber: "+61416827278" });
    });

    it("reports a failed dial as a bad gateway", async () => {
        mockPlaceDemoCall.mockRejectedValueOnce(new Error("SIP trunk not found"));

        const response = await post({ phone: "+61416827278" });

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "SIP trunk not found" });
    });

    it("gives the signed-in user the demo number to prefill", async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ defaultPhone: "+61400000000" });
    });

    it("hides the demo number when signed out", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

        const response = await GET();

        expect(response.status).toBe(401);
    });
});
