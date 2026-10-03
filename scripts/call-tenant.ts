/**
 * @module scripts/call-tenant
 *
 * Demo trigger for a live phone call: dials a real number into a fresh LiveKit room carrying the
 * demo tenancy (`getDemoCallContext()`, overridable via `DEMO_CALL_CONTEXT`). The voice worker
 * must be running to pick up the room.
 *
 * With a Stripe test key it first makes sure the demo invoice is still open (the previous one
 * is closed whenever a plan was written), so the agent never falls back to a Checkout link.
 *
 * Run:
 * ```bash
 * npx tsx scripts/call-tenant.ts --to +15555550102 [--demo]
 * ```
 * `--to` falls back to `DEMO_TENANT_PHONE`. `--demo` selects the demo tenancy, which is
 * currently the only context source and therefore the default. Reads `.env` from the cwd.
 *
 * Depends on: dotenv, @/payments/demo-invoice, @/payments/stripe, @/voice/outbound-call, @/voice/demo-context
 * Used by: manual demo / smoke testing
 */

import "dotenv/config";

import { ensureOpenDemoInvoice } from "../src/payments/demo-invoice";
import { getStripeClient } from "../src/payments/stripe";
import type { CallContext } from "../src/voice/context";
import { getDemoCallContext } from "../src/voice/demo-context";
import { startCollectionCall } from "../src/voice/outbound-call";

const USAGE = "Usage: npx tsx scripts/call-tenant.ts --to +15555550102 [--demo]";

/**
 * Parses `--to <number>` / `--to=<number>` and `--demo` from argv.
 *
 * @param argv - Arguments after the script path
 */
function parseArgs(argv: string[]): { to?: string; demo: boolean } {
    let to: string | undefined;
    let demo = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--to") {
            to = argv[i + 1];
            i += 1;
        } else if (arg.startsWith("--to=")) {
            to = arg.slice("--to=".length);
        } else if (arg === "--demo") {
            demo = true;
        } else if (arg === "--help" || arg === "-h") {
            console.log(USAGE);
            process.exit(0);
        } else {
            console.error(`[call-tenant] Unknown argument: ${arg}\n${USAGE}`);
            process.exit(1);
        }
    }
    return { to, demo };
}

/**
 * Swaps in a payable demo invoice when Stripe test mode is configured. Never blocks the dial:
 * a Stripe failure logs a warning and the stored context goes out unchanged.
 *
 * @param callContext - Demo tenancy the call is about
 */
async function ensureDemoInvoice(callContext: CallContext): Promise<CallContext> {
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
        return callContext;
    }
    const stripe = getStripeClient();
    if (!stripe) {
        return callContext;
    }
    try {
        const { invoiceId, created } = await ensureOpenDemoInvoice({
            stripe,
            demo: callContext,
            invoiceId: process.env.DEMO_STRIPE_INVOICE_ID,
        });
        if (created) {
            console.log(
                `[call-tenant] previous demo invoice is spent; seeded ${invoiceId}. `
                + `Update .env (DEMO_STRIPE_INVOICE_ID=${invoiceId}) so the worker sees it too.`,
            );
        }
        return { ...callContext, stripeInvoiceId: invoiceId };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[call-tenant] could not refresh the demo invoice (${reason}); dialing with the stored id.`);
        return callContext;
    }
}

/**
 * Places the call and prints the room name.
 */
async function main(): Promise<void> {
    const { to: toArg } = parseArgs(process.argv.slice(2));
    const toPhoneNumber = toArg?.trim() || process.env.DEMO_TENANT_PHONE?.trim();
    if (!toPhoneNumber) {
        console.error(`[call-tenant] No number to call. Pass --to or set DEMO_TENANT_PHONE.\n${USAGE}`);
        process.exit(1);
    }

    const callContext = await ensureDemoInvoice(getDemoCallContext());
    console.log(
        `[call-tenant] dialing ${toPhoneNumber} as ${callContext.propertyName} about `
        + `${callContext.tenantName}'s $${callContext.openBalance} balance…`,
    );
    const { roomName } = await startCollectionCall({ toPhoneNumber, callContext });
    console.log(`[call-tenant] ringing. room: ${roomName}`);
    console.log("[call-tenant] watch the voice worker logs for the conversation.");
}

main().catch((error: unknown) => {
    console.error(`[call-tenant] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});