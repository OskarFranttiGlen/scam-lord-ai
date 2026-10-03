/**
 * @module scripts/seed-home-portfolio
 *
 * Replaces the demo landlord's calls with 20 tenants spread across the floor,
 * and creates the Stripe test invoices those Home tiles read after sync.
 * Refuses a live key. Reuses a customer when its invoice is already in the
 * right state.
 *
 * Run: `npx tsx scripts/seed-home-portfolio.ts`
 */

import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { getStripeClient } from "../src/payments/stripe";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const LANDLORD = "a1111111-1111-4111-8111-111111111101";
const MAPLE = "a2222222-2222-4222-8222-222222222201";
const RIVER = "a2222222-2222-4222-8222-222222222202";
const PERK = "a6666666-6666-4666-8666-666666666601";
const ACCOUNT = "acct_1SSVCO90taFgPmTb";

type TMoney = "overdue" | "promised" | "paid";
type TStatus = "in_progress" | "waiting_on_payment" | "waiting_on_person" | "paid";
type THandoff = "hardship" | "dispute" | "distressed";

interface IPerson {
    n: number;
    name: string;
    propertyId: string;
    property: string;
    unit: string;
    tenancyId: string;
    unitId: string;
    existingUnit: boolean;
    step: string;
    status: TStatus;
    money: TMoney;
    dollars: number;
    plan: boolean;
    perk: boolean;
    link: boolean;
    handoff: THandoff | null;
    /** Minutes from first touch to the paid call. */
    minutes: number | null;
    line: string;
}

function uuid(head: string, n: number): string {
    return `${head}-0000000000${String(n).padStart(2, "0")}`;
}

function person(over: IPerson): IPerson {
    return over;
}

const PEOPLE: IPerson[] = [
    person({
        n: 1, name: "Drew Okonkwo", propertyId: MAPLE, property: "Maple Court", unit: "1A",
        tenancyId: uuid("b4444444-4444-4444-8444", 1), unitId: uuid("b3333333-3333-4333-8333", 1),
        existingUnit: false, step: "handoff", status: "waiting_on_person", money: "overdue",
        dollars: 1840, plan: false, perk: false, link: false, handoff: "dispute", minutes: null,
        line: "This balance is wrong. I already paid the office.",
    }),
    person({
        n: 2, name: "Skyler James", propertyId: RIVER, property: "River View Apartments", unit: "3",
        tenancyId: uuid("b4444444-4444-4444-8444", 2), unitId: uuid("b3333333-3333-4333-8333", 2),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 1840, plan: true, perk: false, link: true, handoff: null, minutes: 20,
        line: "I can pay the whole thing right now.",
    }),
    person({
        n: 3, name: "Alex Kim", propertyId: MAPLE, property: "Maple Court", unit: "3C",
        tenancyId: uuid("b4444444-4444-4444-8444", 3), unitId: uuid("b3333333-3333-4333-8333", 3),
        existingUnit: false, step: "payment_link", status: "waiting_on_payment", money: "promised",
        dollars: 1840, plan: true, perk: false, link: true, handoff: null, minutes: null,
        line: "Send the link. I'll pay the first half on Friday.",
    }),
    person({
        n: 4, name: "Jordan Lee", propertyId: MAPLE, property: "Maple Court", unit: "2B",
        tenancyId: "a4444444-4444-4444-8444-444444444401", unitId: "a3333333-3333-4333-8333-333333333301",
        existingUnit: true, step: "invoice", status: "in_progress", money: "overdue",
        dollars: 920, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "Yeah, I know it's late.",
    }),
    person({
        n: 5, name: "Reese Kapoor", propertyId: MAPLE, property: "Maple Court", unit: "4A",
        tenancyId: uuid("b4444444-4444-4444-8444", 5), unitId: uuid("b3333333-3333-4333-8333", 5),
        existingUnit: false, step: "policy", status: "in_progress", money: "promised",
        dollars: 1400, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "What can you actually offer me?",
    }),
    person({
        n: 6, name: "Finley Grant", propertyId: RIVER, property: "River View Apartments", unit: "5",
        tenancyId: uuid("b4444444-4444-4444-8444", 6), unitId: uuid("b3333333-3333-4333-8333", 6),
        existingUnit: false, step: "handoff", status: "waiting_on_person", money: "overdue",
        dollars: 2100, plan: false, perk: false, link: false, handoff: "distressed", minutes: null,
        line: "I can't do this call right now.",
    }),
    person({
        n: 7, name: "Rowan Ellis", propertyId: RIVER, property: "River View Apartments", unit: "8",
        tenancyId: uuid("b4444444-4444-4444-8444", 7), unitId: uuid("b3333333-3333-4333-8333", 7),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 2400, plan: true, perk: false, link: true, handoff: null, minutes: 180,
        line: "Two payments works. I just sent the first.",
    }),
    person({
        n: 8, name: "Parker Singh", propertyId: RIVER, property: "River View Apartments", unit: "11",
        tenancyId: uuid("b4444444-4444-4444-8444", 8), unitId: uuid("b3333333-3333-4333-8333", 8),
        existingUnit: false, step: "payment_link", status: "waiting_on_payment", money: "promised",
        dollars: 920, plan: true, perk: true, link: true, handoff: null, minutes: null,
        line: "If you mow the lawn, I'll take the plan.",
    }),
    person({
        n: 9, name: "Casey Nguyen", propertyId: MAPLE, property: "Maple Court", unit: "5D",
        tenancyId: uuid("b4444444-4444-4444-8444", 9), unitId: uuid("b3333333-3333-4333-8333", 9),
        existingUnit: false, step: "jev", status: "in_progress", money: "overdue",
        dollars: 1650, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "I got hit with a short week at work. I can catch up.",
    }),
    person({
        n: 10, name: "Jamie Ortiz", propertyId: MAPLE, property: "Maple Court", unit: "6B",
        tenancyId: uuid("b4444444-4444-4444-8444", 10), unitId: uuid("b3333333-3333-4333-8333", 10),
        existingUnit: false, step: "plan", status: "in_progress", money: "promised",
        dollars: 2100, plan: true, perk: false, link: false, handoff: null, minutes: null,
        line: "Split it in two. I get paid on the 15th.",
    }),
    person({
        n: 11, name: "Quinn Alvarez", propertyId: RIVER, property: "River View Apartments", unit: "15",
        tenancyId: uuid("b4444444-4444-4444-8444", 11), unitId: uuid("b3333333-3333-4333-8333", 11),
        existingUnit: false, step: "handoff", status: "waiting_on_person", money: "overdue",
        dollars: 2400, plan: false, perk: false, link: false, handoff: "hardship", minutes: null,
        line: "I lost the job. I need a person, not a plan.",
    }),
    person({
        n: 12, name: "Emerson Clarke", propertyId: RIVER, property: "River View Apartments", unit: "18",
        tenancyId: uuid("b4444444-4444-4444-8444", 12), unitId: uuid("b3333333-3333-4333-8333", 12),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 1650, plan: true, perk: false, link: true, handoff: null, minutes: 480,
        line: "Paid. You should see it.",
    }),
    person({
        n: 13, name: "Morgan Blake", propertyId: MAPLE, property: "Maple Court", unit: "8C",
        tenancyId: uuid("b4444444-4444-4444-8444", 13), unitId: uuid("b3333333-3333-4333-8333", 13),
        existingUnit: false, step: "disclosure", status: "in_progress", money: "promised",
        dollars: 1600, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "Go ahead, I'm listening.",
    }),
    person({
        n: 14, name: "Taylor Brooks", propertyId: RIVER, property: "River View Apartments", unit: "21",
        tenancyId: uuid("b4444444-4444-4444-8444", 14), unitId: uuid("b3333333-3333-4333-8333", 14),
        existingUnit: false, step: "plan", status: "in_progress", money: "promised",
        dollars: 1250, plan: true, perk: false, link: false, handoff: null, minutes: null,
        line: "Three installments, then I'm clear.",
    }),
    person({
        n: 15, name: "Sam Rivera", propertyId: RIVER, property: "River View Apartments", unit: "14",
        tenancyId: "a4444444-4444-4444-8444-444444444402", unitId: "a3333333-3333-4333-8333-333333333302",
        existingUnit: true, step: "workflow_start", status: "in_progress", money: "overdue",
        dollars: 1100, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "Hi. What's this about?",
    }),
    person({
        n: 16, name: "Hayden Brooks", propertyId: RIVER, property: "River View Apartments", unit: "22",
        tenancyId: uuid("b4444444-4444-4444-8444", 16), unitId: uuid("b3333333-3333-4333-8333", 16),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 920, plan: false, perk: false, link: true, handoff: null, minutes: 1560,
        line: "Took me a day to move the money. It's sent.",
    }),
    person({
        n: 17, name: "Avery Chen", propertyId: MAPLE, property: "Maple Court", unit: "9B",
        tenancyId: uuid("b4444444-4444-4444-8444", 17), unitId: uuid("b3333333-3333-4333-8333", 17),
        existingUnit: false, step: "workflow_start", status: "in_progress", money: "overdue",
        dollars: 1750, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "Okay, you can continue.",
    }),
    person({
        n: 18, name: "Sage Moretti", propertyId: MAPLE, property: "Maple Court", unit: "11D",
        tenancyId: uuid("b4444444-4444-4444-8444", 18), unitId: uuid("b3333333-3333-4333-8333", 18),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 2100, plan: true, perk: false, link: true, handoff: null, minutes: 45,
        line: "Card's on file. Take it.",
    }),
    person({
        n: 19, name: "Riley Patel", propertyId: MAPLE, property: "Maple Court", unit: "10A",
        tenancyId: uuid("b4444444-4444-4444-8444", 19), unitId: uuid("b3333333-3333-4333-8333", 19),
        existingUnit: false, step: "disclosure", status: "in_progress", money: "overdue",
        dollars: 1980, plan: false, perk: false, link: false, handoff: null, minutes: null,
        line: "Is this a recording?",
    }),
    person({
        n: 20, name: "Cameron Walsh", propertyId: RIVER, property: "River View Apartments", unit: "30",
        tenancyId: uuid("b4444444-4444-4444-8444", 20), unitId: uuid("b3333333-3333-4333-8333", 20),
        existingUnit: false, step: "paid", status: "paid", money: "paid",
        dollars: 1750, plan: true, perk: false, link: true, handoff: null, minutes: 120,
        line: "Both dates are fine. Paying the first one today.",
    }),
];

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

function bucket(invoice: Stripe.Invoice, nowUnix: number): TMoney | null {
    if (invoice.status === "paid" && invoice.amount_paid > 0) return "paid";
    if (invoice.status === "open" && invoice.amount_remaining > 0 && (invoice.due_date ?? 0) > nowUnix) return "promised";
    if ((invoice.status === "open" || invoice.status === "uncollectible") && invoice.amount_remaining > 0) return "overdue";
    return null;
}

async function findCustomer(stripe: Stripe, personSlug: string): Promise<Stripe.Customer | null> {
    const found = await stripe.customers.search({
        query: `metadata['scamlord_seed_slug']:'${personSlug}'`,
        limit: 1,
    });
    return found.data[0] ?? null;
}

async function reusableInvoice(stripe: Stripe, customerId: string, money: TMoney, nowUnix: number): Promise<Stripe.Invoice | null> {
    const list = await stripe.invoices.list({ customer: customerId, limit: 20 });
    return list.data.find((invoice) => bucket(invoice, nowUnix) === money) ?? null;
}

async function draftInvoice(stripe: Stripe, input: {
    customerId: string;
    dollars: number;
    dueDate: number;
    description: string;
    personSlug: string;
}): Promise<Stripe.Invoice> {
    const cents = Math.round(input.dollars * 100);
    const draft = await stripe.invoices.create({
        customer: input.customerId,
        currency: "usd",
        collection_method: "send_invoice",
        due_date: input.dueDate,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: input.description,
        metadata: { scamlord_home_seed: "1", scamlord_seed_slug: input.personSlug },
    });
    await stripe.invoiceItems.create({
        customer: input.customerId,
        invoice: draft.id,
        amount: cents,
        currency: "usd",
        description: input.description,
    });
    return stripe.invoices.finalizeInvoice(draft.id, { auto_advance: false });
}

/**
 * Test clocks hold 3 customers. Keep a past clock with room so due dates land before today.
 * ponytail: one clock per 3 overdue tenants; Stripe's cap is 3.
 */
async function pastClock(stripe: Stripe, nowUnix: number, full: ReadonlySet<string>): Promise<string> {
    const list = await stripe.testHelpers.testClocks.list({ limit: 100 });
    const reusable = list.data.find((clock) => (
        clock.name?.startsWith("home-seed-overdue")
        && clock.status === "ready"
        && clock.frozen_time <= nowUnix - 14 * 86_400
        && !full.has(clock.id)
    ));
    if (reusable) return reusable.id;
    const created = await stripe.testHelpers.testClocks.create({
        frozen_time: nowUnix - 21 * 86_400,
        name: `home-seed-overdue-${full.size + 1}`,
    });
    return created.id;
}

async function createCustomer(stripe: Stripe, who: IPerson, personSlug: string, nowUnix: number, fullClocks: Set<string>): Promise<Stripe.Customer> {
    const base = {
        name: who.name,
        email: `${personSlug}@example.com`,
        metadata: { scamlord_home_seed: "1", scamlord_seed_slug: personSlug },
    };
    if (who.money !== "overdue") return stripe.customers.create(base);

    for (let attempt = 0; attempt < 4; attempt++) {
        const clockId = await pastClock(stripe, nowUnix, fullClocks);
        try {
            return await stripe.customers.create({ ...base, test_clock: clockId });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes("maximum number")) throw error;
            fullClocks.add(clockId);
        }
    }
    return stripe.customers.create(base);
}

async function ensureInvoice(stripe: Stripe, who: IPerson, nowUnix: number, fullClocks: Set<string>): Promise<Stripe.Invoice> {
    const personSlug = slug(who.name);
    const description = `${who.property} rent, ${who.unit}`;
    let customer = await findCustomer(stripe, personSlug);
    if (customer) {
        const existing = await reusableInvoice(stripe, customer.id, who.money, nowUnix);
        if (existing) return existing;
    }

    if (!customer) customer = await createCustomer(stripe, who, personSlug, nowUnix, fullClocks);

    if (who.money === "paid") {
        const open = await draftInvoice(stripe, {
            customerId: customer.id,
            dollars: who.dollars,
            dueDate: nowUnix + 86_400,
            description,
            personSlug,
        });
        return stripe.invoices.pay(open.id, { paid_out_of_band: true });
    }

    if (who.money === "promised") {
        return draftInvoice(stripe, {
            customerId: customer.id,
            dollars: who.dollars,
            dueDate: nowUnix + 14 * 86_400,
            description,
            personSlug,
        });
    }

    if (customer.test_clock) {
        const clock = await stripe.testHelpers.testClocks.retrieve(
            typeof customer.test_clock === "string" ? customer.test_clock : customer.test_clock.id,
        );
        return draftInvoice(stripe, {
            customerId: customer.id,
            dollars: who.dollars,
            dueDate: clock.frozen_time + 3 * 86_400,
            description,
            personSlug,
        });
    }

    const open = await draftInvoice(stripe, {
        customerId: customer.id,
        dollars: who.dollars,
        dueDate: nowUnix + 3_600,
        description,
        personSlug,
    });
    return stripe.invoices.markUncollectible(open.id);
}

function jev(who: IPerson): unknown[] {
    const reached = ["jev", "policy", "plan", "payment_link", "paid", "handoff"].includes(who.step);
    if (!reached) return [];
    const decision = who.handoff ? "handoff" : "continue";
    return [{
        probabilities: {
            hardship: who.handoff === "hardship" ? 0.82 : 0.12,
            dispute: who.handoff === "dispute" ? 0.8 : 0.08,
            distressed: who.handoff === "distressed" ? 0.77 : 0.05,
        },
        outcome: { decision },
    }];
}

function planRow(who: IPerson, callId: string) {
    const count = who.dollars > 2000 ? 3 : 2;
    const each = Math.round((who.dollars / count) * 100) / 100;
    const today = new Date();
    const dates = Array.from({ length: count }, (_, index) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + 14 * (index + 1));
        return date.toISOString().slice(0, 10);
    });
    return {
        id: uuid("b8888888-8888-4888-8888", who.n),
        call_id: callId,
        installment_count: count,
        installment_dates: dates,
        installment_amounts: Array.from({ length: count }, () => each),
        perk_id: who.perk ? PERK : null,
    };
}

async function landlordTenancyIds(db: SupabaseClient): Promise<string[]> {
    const properties = await db.from("properties").select("id").eq("landlord_id", LANDLORD);
    if (properties.error) throw new Error(properties.error.message);
    const propertyIds = (properties.data ?? []).map((row) => row.id as string);
    const units = await db.from("units").select("id").in("property_id", propertyIds);
    if (units.error) throw new Error(units.error.message);
    const unitIds = (units.data ?? []).map((row) => row.id as string);
    if (unitIds.length === 0) return [];
    const tenancies = await db.from("tenancies").select("id").in("unit_id", unitIds);
    if (tenancies.error) throw new Error(tenancies.error.message);
    return (tenancies.data ?? []).map((row) => row.id as string);
}

async function mirrorInvoices(db: SupabaseClient, invoices: Stripe.Invoice[]): Promise<string | null> {
    const rows = invoices.map((invoice) => ({
        id: invoice.id,
        _account_id: ACCOUNT,
        _raw_data: {
            id: invoice.id,
            object: "invoice",
            amount_paid: invoice.amount_paid,
            amount_remaining: invoice.amount_remaining,
            status: invoice.status,
            due_date: invoice.due_date,
            metadata: invoice.metadata,
            customer: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null,
        },
        amount_paid: invoice.amount_paid,
        amount_remaining: invoice.amount_remaining,
        amount_due: invoice.amount_due,
        status: invoice.status,
        due_date: invoice.due_date,
        metadata: invoice.metadata,
        currency: invoice.currency,
        customer: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null,
        customer_name: invoice.customer_name,
        hosted_invoice_url: invoice.hosted_invoice_url,
        livemode: invoice.livemode,
        paid: invoice.status === "paid",
        object: "invoice",
    }));
    const { error } = await db.schema("stripe").from("invoices").upsert(rows, { onConflict: "id" });
    return error ? error.message : null;
}

async function main(): Promise<void> {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
        throw new Error("STRIPE_SECRET_KEY must be a test key");
    }
    const stripe = getStripeClient();
    if (!stripe) throw new Error("STRIPE_SECRET_KEY missing");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
        || process.env.NEXT_PUBLIC_REACT_APP_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
        || process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !key) throw new Error("Supabase URL or service role key missing");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const now = Date.now();
    const nowUnix = Math.floor(now / 1000);
    const fullClocks = new Set<string>();

    const invoices: Stripe.Invoice[] = [];
    for (const who of PEOPLE) {
        const invoice = await ensureInvoice(stripe, who, nowUnix, fullClocks);
        invoices.push(invoice);
        console.log(`[seed-home] ${who.name} ${who.money} ${who.step} ${invoice.id} ${invoice.status}`);
    }

    const tenancyIds = await landlordTenancyIds(db);
    if (tenancyIds.length > 0) {
        const removed = await db.from("calls").delete().in("tenancy_id", tenancyIds);
        if (removed.error) throw new Error(removed.error.message);
    }

    const units = PEOPLE.filter((who) => !who.existingUnit).map((who) => ({
        id: who.unitId,
        property_id: who.propertyId,
        label: `Unit ${who.unit}`,
        external_pms_id: `home_seed_unit_${who.n}`,
    }));
    const savedUnits = await db.from("units").upsert(units, { onConflict: "id" });
    if (savedUnits.error) throw new Error(savedUnits.error.message);

    const tenancies = PEOPLE.map((who, index) => ({
        id: who.tenancyId,
        unit_id: who.unitId,
        name: who.name,
        phone: `+15555553${String(index + 1).padStart(3, "0")}`,
        email: `${slug(who.name)}@example.com`,
        language: "en",
        stripe_customer_id: typeof invoices[index].customer === "string"
            ? invoices[index].customer
            : invoices[index].customer?.id ?? null,
        ...(who.existingUnit ? {} : { external_pms_id: `home_seed_tenancy_${who.n}` }),
    }));
    for (const row of tenancies) {
        const saved = await db.from("tenancies").upsert(row, { onConflict: "id" });
        if (saved.error) throw new Error(`${row.name}: ${saved.error.message}`);
    }

    const calls = PEOPLE.map((who, index) => {
        const touch = now - index * 3 * 3_600_000;
        const minutes = who.minutes;
        const ended = minutes == null ? null : touch;
        const started = minutes == null ? touch : touch - minutes * 60_000;
        const first = who.name.split(" ")[0];
        return {
            id: uuid("b7777777-7777-4777-8777", who.n),
            tenancy_id: who.tenancyId,
            stripe_invoice_id: invoices[index].id,
            status: who.status,
            current_step: who.step,
            transcript: `Agent: Hi ${first}, this is the assistant for ${who.property}, calling about the open rent.\nTenant: ${who.line}`,
            jev_checks: jev(who),
            handoff_reason: who.handoff,
            payment_link_sent: who.link,
            started_at: new Date(started).toISOString(),
            ended_at: ended == null ? null : new Date(ended).toISOString(),
            updated_at: new Date(now - index * 3 * 3_600_000).toISOString(),
        };
    });
    const savedCalls = await db.from("calls").upsert(calls, { onConflict: "id" });
    if (savedCalls.error) throw new Error(savedCalls.error.message);

    const plans = PEOPLE.flatMap((who) => (
        who.plan ? [planRow(who, uuid("b7777777-7777-4777-8777", who.n))] : []
    ));
    const savedPlans = await db.from("plans").upsert(plans, { onConflict: "id" });
    if (savedPlans.error) throw new Error(savedPlans.error.message);

    const mirrorError = await mirrorInvoices(db, invoices);
    if (mirrorError) console.error(`[seed-home] stripe.invoices mirror skipped: ${mirrorError}`);
    else console.log(`[seed-home] mirrored ${invoices.length} invoices into stripe.invoices`);

    const clocks = await stripe.testHelpers.testClocks.list({ limit: 100 });
    for (const clock of clocks.data) {
        if (!clock.name?.startsWith("home-seed-overdue") || clock.status !== "ready" || clock.frozen_time >= nowUnix - 86_400) continue;
        try {
            await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: nowUnix });
            console.log(`[seed-home] advanced ${clock.name} to now`);
        } catch (error: unknown) {
            console.error(`[seed-home] ${clock.name} left in the past:`, error instanceof Error ? error.message : error);
        }
    }

    console.log(`[seed-home] ${PEOPLE.length} people`);
}

main().catch((error: unknown) => {
    console.error("[seed-home]", error instanceof Error ? error.message : error);
    process.exit(1);
});
