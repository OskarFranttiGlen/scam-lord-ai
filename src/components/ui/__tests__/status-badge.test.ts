import { describe, expect, it } from "vitest";
import { STATUS } from "@/components/ui/status-badge";

describe("STATUS", () => {
    it("uses the fixed labels and token pairs", () => {
        expect(STATUS.overdue).toEqual({ label: "Overdue", token: "overdue" });
        expect(STATUS["payment-failed"]).toEqual({ label: "Payment failed", token: "overdue" });
        expect(STATUS["in-progress"]).toEqual({ label: "In progress", token: "active" });
        expect(STATUS["waiting-on-person"]).toEqual({ label: "Waiting on a person", token: "waiting" });
        expect(STATUS["waiting-on-payment"]).toEqual({ label: "Waiting on payment", token: "waiting" });
        expect(STATUS["plan-active"]).toEqual({ label: "Plan active", token: "paid" });
        expect(STATUS.paid).toEqual({ label: "Paid", token: "paid" });
    });
});
