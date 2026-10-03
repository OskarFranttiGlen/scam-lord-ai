/**
 * @module payments/collection-context
 *
 * Turns an overdue or failed Stripe invoice into the collection call request: the number to
 * dial and the voice agent's `CallContext`. Stripe supplies the balance, due date, and invoice
 * id; Supabase supplies the tenancy, property, unit, policy, and perks (docs/SPEC.md → Data).
 * Anything Supabase cannot answer falls back to `getDemoCallContext()`.
 *
 * Depends on: stripe, @supabase/supabase-js, zod, @/voice/context, ./stripe
 * Used by: @/payments/webhook-events
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { z } from "zod";

import { getDemoCallContext, type CallContext, type TCallPerk, type TCallPolicy } from "@/voice/context";
import { centsToDollars } from "./stripe";

let cachedDb: SupabaseClient | null = null;

/**
 * Service-role Supabase client for the collection tables, or `null` when unconfigured.
 * Untyped because `src/hooks/supabase.ts` does not include the collection migration yet.
 */
export function getCollectionDb(): SupabaseClient | null {
    if (cachedDb) {
        return cachedDb;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
        return null;
    }

    cachedDb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return cachedDb;
}

const propertySchema = z.object({ name: z.string(), landlord_id: z.string() });
const unitSchema = z.object({
    label: z.string(),
    properties: z.union([propertySchema, z.array(propertySchema)]).nullable(),
});
const tenancySchema = z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().nullable(),
    units: z.union([unitSchema, z.array(unitSchema)]).nullable(),
});
const policySchema = z.object({
    max_installments: z.coerce.number(),
    grace_days: z.coerce.number(),
    fee_waiver_cap: z.coerce.number(),
});
const perkSchema = z.object({ id: z.string(), body: z.string(), condition_text: z.string() });
const landlordSchema = z.object({ stripe_connected_account_id: z.string().nullable() });

function one<T>(value: T | T[] | null): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value;
}

export type TTenancyRecord = {
    tenancyId: string;
    tenantName: string;
    phone: string;
    email: string | null;
    propertyName: string | null;
    unitLabel: string | null;
    landlordId: string | null;
    policy: TCallPolicy | null;
    perks: TCallPerk[] | null;
    connectedAccountId: string | null;
};

/**
 * Loads the tenancy for a Stripe customer (or an explicit tenancy id from invoice metadata)
 * with its landlord's policy, perks, and connected account. Returns `null` when no row matches.
 *
 * @param db - Service-role Supabase client
 * @param lookup - Stripe customer id and optional `scamlord_tenancy_id` metadata value
 */
export async function loadTenancyRecord(
    db: SupabaseClient,
    lookup: { stripeCustomerId: string | null; tenancyId?: string | null },
): Promise<TTenancyRecord | null> {
    const column = lookup.tenancyId ? "id" : "stripe_customer_id";
    const value = lookup.tenancyId ?? lookup.stripeCustomerId;
    if (!value) {
        return null;
    }

    const { data, error } = await db
        .from("tenancies")
        .select("id, name, phone, email, units(label, properties(name, landlord_id))")
        .eq(column, value)
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new Error(`tenancies lookup failed: ${error.message}`);
    }
    if (!data) {
        return null;
    }

    const tenancy = tenancySchema.parse(data);
    const unit = one(tenancy.units);
    const property = unit ? one(unit.properties) : null;
    const landlordId = property?.landlord_id ?? null;

    const record: TTenancyRecord = {
        tenancyId: tenancy.id,
        tenantName: tenancy.name,
        phone: tenancy.phone,
        email: tenancy.email,
        propertyName: property?.name ?? null,
        unitLabel: unit?.label ?? null,
        landlordId,
        policy: null,
        perks: null,
        connectedAccountId: null,
    };
    if (!landlordId) {
        return record;
    }

    const [policyResult, perksResult, landlordResult] = await Promise.all([
        db.from("policies")
            .select("max_installments, grace_days, fee_waiver_cap")
            .eq("landlord_id", landlordId)
            .maybeSingle(),
        db.from("perks").select("id, body, condition_text").eq("landlord_id", landlordId),
        db.from("landlords").select("stripe_connected_account_id").eq("id", landlordId).maybeSingle(),
    ]);

    if (policyResult.data) {
        const policy = policySchema.parse(policyResult.data);
        record.policy = {
            maxInstallments: policy.max_installments,
            graceDays: policy.grace_days,
            feeWaiverCap: policy.fee_waiver_cap,
        };
    }
    if (perksResult.data) {
        record.perks = z.array(perkSchema).parse(perksResult.data).map(perk => ({
            id: perk.id,
            description: perk.body,
            condition: perk.condition_text,
        }));
    }
    if (landlordResult.data) {
        record.connectedAccountId = landlordSchema.parse(landlordResult.data).stripe_connected_account_id;
    }
    return record;
}

export type TCollectionCallRequest = {
    toPhoneNumber: string;
    callContext: CallContext;
    tenancyId: string | null;
    /** Landlord's Stripe connected account, for destination charges on the link and plan. */
    connectedAccountId: string | null;
    /** `supabase` when a tenancy row matched; `demo_fallback` when demo values filled the gaps. */
    source: "supabase" | "demo_fallback";
};

function isoDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function stripeCustomerId(invoice: Stripe.Invoice): string | null {
    const customer = invoice.customer;
    if (customer == null) {
        return null;
    }
    return typeof customer === "string" ? customer : customer.id;
}

/**
 * Builds the `startCollectionCall` input for an invoice. Tenancy contact details win over the
 * Stripe customer's; policy, perks, property, and unit come from Supabase or the demo context.
 *
 * @param input - Invoice, optional expanded customer, optional Supabase client, optional logger
 */
export async function buildCollectionCallRequest(input: {
    invoice: Stripe.Invoice;
    customer?: Stripe.Customer | null;
    db: SupabaseClient | null;
    log?: Pick<Console, "warn">;
}): Promise<TCollectionCallRequest> {
    const { invoice, customer, db } = input;
    const log = input.log ?? console;
    const demo = getDemoCallContext();

    let record: TTenancyRecord | null = null;
    if (db) {
        try {
            record = await loadTenancyRecord(db, {
                stripeCustomerId: stripeCustomerId(invoice),
                tenancyId: invoice.metadata?.scamlord_tenancy_id ?? null,
            });
        } catch (error) {
            log.warn("[stripe] tenancy lookup failed; using demo context", error);
        }
    }

    const callContext: CallContext = {
        tenantName: record?.tenantName ?? invoice.customer_name ?? customer?.name ?? demo.tenantName,
        propertyName: record?.propertyName ?? demo.propertyName,
        unitLabel: record?.unitLabel ?? demo.unitLabel,
        phone: record?.phone ?? invoice.customer_phone ?? customer?.phone ?? demo.phone,
        email: record?.email ?? invoice.customer_email ?? customer?.email ?? demo.email,
        openBalance: centsToDollars(invoice.amount_remaining),
        invoiceDueDate: isoDate(invoice.due_date ?? invoice.created),
        policy: record?.policy ?? demo.policy,
        perks: record?.perks ?? demo.perks,
        stripeInvoiceId: invoice.id,
    };

    return {
        toPhoneNumber: callContext.phone,
        callContext,
        tenancyId: record?.tenancyId ?? null,
        connectedAccountId: record?.connectedAccountId ?? null,
        source: record?.policy ? "supabase" : "demo_fallback",
    };
}
