import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDemoCallContext } from "../demo-context";
import { TENANT_SIP_PARTICIPANT_IDENTITY, startCollectionCall } from "../outbound-call";

const { createRoom, deleteRoom, createSipParticipant, roomCtor, sipCtor } = vi.hoisted(() => ({
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    createSipParticipant: vi.fn(),
    roomCtor: vi.fn(),
    sipCtor: vi.fn(),
}));

vi.mock("livekit-server-sdk", () => ({
    RoomServiceClient: class {
        createRoom = createRoom;
        deleteRoom = deleteRoom;
        constructor(...args: unknown[]) {
            roomCtor(...args);
        }
    },
    SipClient: class {
        createSipParticipant = createSipParticipant;
        constructor(...args: unknown[]) {
            sipCtor(...args);
        }
    },
}));

const CONTEXT = getDemoCallContext();

beforeEach(() => {
    vi.stubEnv("DEMO_CALL_CONTEXT", "");
    vi.stubEnv("LIVEKIT_URL", "wss://demo.livekit.cloud");
    vi.stubEnv("LIVEKIT_API_KEY", "key");
    vi.stubEnv("LIVEKIT_API_SECRET", "secret");
    vi.stubEnv("LIVEKIT_SIP_OUTBOUND_TRUNK_ID", "ST_trunk");
    createRoom.mockResolvedValue({});
    deleteRoom.mockResolvedValue(undefined);
    createSipParticipant.mockResolvedValue({});
});

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

describe("startCollectionCall", () => {
    it("creates a room carrying callContext metadata, then dials the tenant into it", async () => {
        const { roomName } = await startCollectionCall({ toPhoneNumber: "+14155550123", callContext: CONTEXT });

        expect(roomName).toMatch(/^collect-in_demo_maple_2b_sep-[a-z0-9]+$/);
        expect(roomCtor).toHaveBeenCalledWith("https://demo.livekit.cloud", "key", "secret");
        expect(sipCtor).toHaveBeenCalledWith("https://demo.livekit.cloud", "key", "secret");

        const [createOptions] = createRoom.mock.calls[0] as [{ name: string; metadata: string; emptyTimeout: number }];
        expect(createOptions.name).toBe(roomName);
        expect(createOptions.emptyTimeout).toBeGreaterThan(0);
        expect(JSON.parse(createOptions.metadata)).toEqual({
            callContext: { ...CONTEXT, phone: "+14155550123" },
        });

        expect(createSipParticipant).toHaveBeenCalledWith(
            "ST_trunk",
            "+14155550123",
            roomName,
            expect.objectContaining({
                participantIdentity: TENANT_SIP_PARTICIPANT_IDENTITY,
                participantName: "Jordan Lee",
                waitUntilAnswered: false,
            }),
        );
        expect(createRoom.mock.invocationCallOrder[0]).toBeLessThan(
            createSipParticipant.mock.invocationCallOrder[0],
        );
    });

    it("throws a clear error naming the missing trunk env before touching LiveKit", async () => {
        vi.stubEnv("LIVEKIT_SIP_OUTBOUND_TRUNK_ID", "");

        await expect(startCollectionCall({ toPhoneNumber: "+14155550123", callContext: CONTEXT })).rejects.toThrow(
            /missing LIVEKIT_SIP_OUTBOUND_TRUNK_ID.*setup-livekit-sip/,
        );
        expect(createRoom).not.toHaveBeenCalled();
    });

    it("rejects a number that is not E.164", async () => {
        await expect(startCollectionCall({ toPhoneNumber: "415-555-0123", callContext: CONTEXT })).rejects.toThrow(
            "is not an E.164 number",
        );
        expect(createRoom).not.toHaveBeenCalled();
    });

    it("deletes the room and rethrows when the SIP dial fails", async () => {
        createSipParticipant.mockRejectedValue(new Error("trunk not found"));

        await expect(startCollectionCall({ toPhoneNumber: "+14155550123", callContext: CONTEXT })).rejects.toThrow(
            "SIP dial failed: trunk not found",
        );
        const [{ name }] = createRoom.mock.calls[0] as [{ name: string }];
        expect(deleteRoom).toHaveBeenCalledWith(name);
    });
});
