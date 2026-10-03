import { afterEach, describe, expect, it, vi } from "vitest";

import { getDemoCallContext } from "../demo-context";

describe("getDemoCallContext", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("uses the placeholder invoice when no seeded invoice is configured", () => {
        vi.stubEnv("DEMO_STRIPE_INVOICE_ID", "");

        expect(getDemoCallContext().stripeInvoiceId).toBe("in_demo_maple_2b_sep");
    });

    it("uses the seeded Stripe invoice from DEMO_STRIPE_INVOICE_ID", () => {
        vi.stubEnv("DEMO_STRIPE_INVOICE_ID", " in_1SeededDemo ");

        expect(getDemoCallContext().stripeInvoiceId).toBe("in_1SeededDemo");
    });
});
