// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { getDemoCallContext } from "@/voice/context";
import { ensureOpenDemoInvoice } from "../demo-invoice";

function asStripe(value: unknown): Stripe {
    return value as Stripe;
}

function storedInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: "in_stored",
        status: "open",
        amount_remaining: 184000,
        metadata: {},
        ...overrides,
    };
}

type TSeedMockInput = {
    stored?: unknown;
    /** Retrieval fails (deleted/unreachable invoice). */
    missing?: boolean;
    customers?: Array<{ id: string }>;
};

/**
 * Stripe mock covering the whole seed path: retrieval of the stored invoice, demo customer
 * search/create, and draft → item → finalize.
 */
function seedMock(input: TSeedMockInput = {}) {
    const retrieve = vi.fn(input.missing
        ? async () => {
            throw new Error("No such invoice: in_stored");
        }
        : async () => input.stored);
    const search = vi.fn(async () => ({ data: input.customers ?? [{ id: "cus_demo" }] }));
    const customersCreate = vi.fn(async () => ({ id: "cus_new" }));
    const invoicesCreate = vi.fn(async () => ({ id: "in_draft" }));
    const invoiceItemsCreate = vi.fn(async () => ({ id: "ii_1" }));
    const finalizeInvoice = vi.fn(async (id: string) => ({
        id,
        status: "open",
        amount_remaining: 184000,
    }));
    const stripe = {
        invoices: { retrieve, create: invoicesCreate, finalizeInvoice },
        invoiceItems: { create: invoiceItemsCreate },
        customers: { search, create: customersCreate },
    };
    return { stripe, retrieve, search, customersCreate, invoicesCreate, invoiceItemsCreate, finalizeInvoice };
}

const now = new Date("2026-10-03T19:00:00Z");

describe("ensureOpenDemoInvoice", () => {
    it("reuses an open stored invoice that matches the demo balance and is not rescheduled", async () => {
        const m = seedMock({ stored: storedInvoice() });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result).toEqual({ invoiceId: "in_stored", created: false });
        expect(m.invoicesCreate).not.toHaveBeenCalled();
        expect(m.search).not.toHaveBeenCalled();
    });

    it("creates a fresh invoice when the stored one is paid", async () => {
        const m = seedMock({ stored: storedInvoice({ status: "paid", amount_remaining: 0 }) });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result).toEqual({ invoiceId: "in_draft", created: true });
    });

    it("creates a fresh invoice when the stored one is void", async () => {
        const m = seedMock({ stored: storedInvoice({ status: "void" }) });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result.created).toBe(true);
    });

    it("creates a fresh invoice when the stored one was rescheduled into a plan", async () => {
        const m = seedMock({
            stored: storedInvoice({ status: "paid", metadata: { scamlord_plan_status: "rescheduled" } }),
        });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result.created).toBe(true);
    });

    it("creates a fresh invoice when the stored one is missing in Stripe", async () => {
        const m = seedMock({ missing: true });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result).toEqual({ invoiceId: "in_draft", created: true });
    });

    it("creates a fresh invoice when the stored amount differs from the demo balance", async () => {
        const m = seedMock({ stored: storedInvoice({ amount_remaining: 92000 }) });

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(result.created).toBe(true);
    });

    it("creates a fresh invoice without retrieving anything when no invoice id is set", async () => {
        const m = seedMock();

        const result = await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: undefined,
        });

        expect(result).toEqual({ invoiceId: "in_draft", created: true });
        expect(m.retrieve).not.toHaveBeenCalled();
    });

    it("reuses the existing demo customer found by metadata", async () => {
        const m = seedMock({ missing: true, customers: [{ id: "cus_demo" }] });

        await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(m.search).toHaveBeenCalledWith({ query: "metadata['scamlord_demo_tenant']:'true'" });
        expect(m.customersCreate).not.toHaveBeenCalled();
        expect(m.invoicesCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_demo" }));
    });

    it("creates the demo customer when the metadata search finds none", async () => {
        const m = seedMock({ missing: true, customers: [] });

        await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
        });

        expect(m.customersCreate).toHaveBeenCalledWith({
            name: "Jordan Lee",
            email: "jordan.lee@example.com",
            phone: "+15555550102",
            metadata: { scamlord_demo_tenant: "true" },
        });
        expect(m.invoicesCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_new" }));
    });

    it("seeds the same finalized send_invoice invoice as the seed script", async () => {
        const m = seedMock({ missing: true });

        await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo: getDemoCallContext(),
            invoiceId: "in_stored",
            now,
        });

        expect(m.invoicesCreate).toHaveBeenCalledWith(expect.objectContaining({
            customer: "cus_demo",
            currency: "usd",
            collection_method: "send_invoice",
            due_date: now.getTime() / 1000 + 3600,
            auto_advance: false,
            pending_invoice_items_behavior: "exclude",
            description: "Maple Court rent, Unit 2B",
        }));
        expect(m.invoiceItemsCreate).toHaveBeenCalledWith(expect.objectContaining({
            customer: "cus_demo",
            invoice: "in_draft",
            amount: 184000,
            currency: "usd",
            description: "September rent, Unit 2B",
        }));
        expect(m.finalizeInvoice).toHaveBeenCalledWith("in_draft", { auto_advance: false });
    });

    it("keeps a future due date instead of the one-hour floor", async () => {
        const m = seedMock({ missing: true });
        const demo = { ...getDemoCallContext(), invoiceDueDate: "2026-12-01" };

        await ensureOpenDemoInvoice({
            stripe: asStripe(m.stripe),
            demo,
            invoiceId: "in_stored",
            now,
        });

        expect(m.invoicesCreate).toHaveBeenCalledWith(expect.objectContaining({
            due_date: Date.UTC(2026, 11, 1, 23, 59, 59) / 1000,
        }));
    });
});