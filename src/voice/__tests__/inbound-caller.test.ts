import { ParticipantKind } from "@livekit/rtc-node";
import { describe, expect, it } from "vitest";

import { detectInboundCaller, isCallbackRoom, normalizePhoneE164 } from "@/voice/inbound-caller";

const SIP_CALLER = {
    identity: "sip_+15555550201",
    kind: ParticipantKind.SIP,
    attributes: { "sip.phoneNumber": "+15555550201", "sip.trunkPhoneNumber": "+15555550100" },
};

describe("isCallbackRoom", () => {
    it("matches rooms created by the callback dispatch rule", () => {
        expect(isCallbackRoom("callback-_+15555550201_abc")).toBe(true);
        expect(isCallbackRoom("collect-in_123-x")).toBe(false);
        expect(isCallbackRoom("smoke-123")).toBe(false);
    });
});

describe("detectInboundCaller", () => {
    it("returns the caller's E.164 number for a SIP participant in a callback room", () => {
        expect(detectInboundCaller("callback-1", SIP_CALLER)).toEqual({
            identity: "sip_+15555550201",
            phoneNumber: "+15555550201",
        });
    });

    it("ignores rooms that are not callback rooms (outbound and browser calls)", () => {
        expect(detectInboundCaller("collect-in_1-x", SIP_CALLER)).toBeNull();
    });

    it("ignores the dialed outbound tenant even in a callback-prefixed room", () => {
        expect(detectInboundCaller("callback-1", { ...SIP_CALLER, identity: "tenant" })).toBeNull();
    });

    it("returns a caller without a number when the dispatch rule hides it", () => {
        expect(detectInboundCaller("callback-1", { ...SIP_CALLER, attributes: {} })).toEqual({
            identity: "sip_+15555550201",
            phoneNumber: null,
        });
    });

    it("does not trust a phone attribute on a non-SIP participant (tokens can set attributes)", () => {
        const browser = { ...SIP_CALLER, kind: ParticipantKind.STANDARD };
        expect(detectInboundCaller("callback-1", browser)).toEqual({
            identity: "sip_+15555550201",
            phoneNumber: null,
        });
    });

    it("trusts a non-SIP phone attribute only with the dev override", () => {
        const browser = { ...SIP_CALLER, kind: ParticipantKind.STANDARD };
        expect(detectInboundCaller("callback-1", browser, { allowFakeSipCallers: true })?.phoneNumber)
            .toBe("+15555550201");
    });
});

describe("normalizePhoneE164", () => {
    it.each([
        ["+15555550201", "+15555550201"],
        ["15555550201", "+15555550201"],
        ["(555) 555-0201", "+15555550201"],
        ["sip:+15555550201@pstn.twilio.com", "+15555550201"],
        ["+44 20 7946 0958", "+442079460958"],
    ])("normalizes %s", (raw, expected) => {
        expect(normalizePhoneE164(raw)).toBe(expected);
    });

    it.each(["", "anonymous", "12345"])("rejects %s", (raw) => {
        expect(normalizePhoneE164(raw)).toBeNull();
    });
});
