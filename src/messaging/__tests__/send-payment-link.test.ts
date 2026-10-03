import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "../email";
import {
    buildPaymentLinkEmail,
    buildPaymentLinkSms,
    formatDollars,
    sendPaymentLinkMessages,
    type TPaymentLinkInput,
} from "../send-payment-link";
import { sendSms } from "../sms";

vi.mock("../sms", () => ({ sendSms: vi.fn() }));
vi.mock("../email", () => ({ sendEmail: vi.fn() }));

const sendSmsMock = vi.mocked(sendSms);
const sendEmailMock = vi.mocked(sendEmail);

const INPUT: TPaymentLinkInput = {
    tenantName: "Jordan Lee",
    phone: "+15555550102",
    email: "jordan.lee@example.com",
    propertyName: "Maple Court",
    amountDollars: 1840,
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
};

beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe("formatDollars", () => {
    it("drops cents for whole dollars and keeps them otherwise", () => {
        expect(formatDollars(1840)).toBe("$1,840");
        expect(formatDollars(920.5)).toBe("$920.50");
    });
});

describe("message copy", () => {
    it("SMS names the tenant, amount, property, and link, and invites a reply", () => {
        expect(buildPaymentLinkSms(INPUT)).toBe(
            "Hi Jordan, thanks for talking with us. Here's your secure link to pay $1,840 for Maple Court: "
            + "https://checkout.stripe.com/c/pay/cs_test_123 Questions? Just reply here.",
        );
    });

    it("email carries the same link and escapes HTML", () => {
        const email = buildPaymentLinkEmail({ ...INPUT, propertyName: "Oak & <Pine>" });
        expect(email.subject).toBe("Your payment link for Oak & <Pine>");
        expect(email.text).toContain(INPUT.url);
        expect(email.html).toContain(`href="${INPUT.url}"`);
        expect(email.html).toContain("Oak &amp; &lt;Pine&gt;");
        expect(email.html).not.toContain("<Pine>");
    });
});

describe("sendPaymentLinkMessages", () => {
    it("sends both channels and returns provider ids", async () => {
        sendSmsMock.mockResolvedValue({ sid: "SM1" });
        sendEmailMock.mockResolvedValue({ id: "email_1" });

        const result = await sendPaymentLinkMessages(INPUT);

        expect(result).toEqual({
            sms: { status: "sent", id: "SM1" },
            email: { status: "sent", id: "email_1" },
            anySent: true,
        });
        expect(sendSmsMock).toHaveBeenCalledWith({ to: INPUT.phone, body: buildPaymentLinkSms(INPUT) });
        expect(sendEmailMock).toHaveBeenCalledWith({ to: INPUT.email, ...buildPaymentLinkEmail(INPUT) });
    });

    it("skips a channel whose address is missing or blank", async () => {
        sendEmailMock.mockResolvedValue({ id: "email_1" });

        const result = await sendPaymentLinkMessages({ ...INPUT, phone: "  " });

        expect(result.sms).toEqual({ status: "skipped", reason: "no phone number" });
        expect(result.email.status).toBe("sent");
        expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it("skips SMS when only email is requested", async () => {
        sendEmailMock.mockResolvedValue({ id: "email_1" });

        const result = await sendPaymentLinkMessages({ ...INPUT, channels: ["email"] });

        expect(result.sms).toEqual({ status: "skipped", reason: "sms not requested" });
        expect(result.email.status).toBe("sent");
        expect(sendSmsMock).not.toHaveBeenCalled();
    });

    it("never throws: a failing channel is reported and logged while the other still sends", async () => {
        sendSmsMock.mockRejectedValue(new Error("Twilio down"));
        sendEmailMock.mockResolvedValue({ id: "email_1" });

        const result = await sendPaymentLinkMessages(INPUT);

        expect(result.sms).toEqual({ status: "failed", error: "Twilio down" });
        expect(result.email).toEqual({ status: "sent", id: "email_1" });
        expect(result.anySent).toBe(true);
        expect(console.error).toHaveBeenCalledWith("[messaging] payment link sms failed: Twilio down");
    });

    it("reports anySent false when both channels fail", async () => {
        sendSmsMock.mockRejectedValue(new Error("a"));
        sendEmailMock.mockRejectedValue(new Error("b"));

        await expect(sendPaymentLinkMessages(INPUT)).resolves.toMatchObject({ anySent: false });
    });
});
