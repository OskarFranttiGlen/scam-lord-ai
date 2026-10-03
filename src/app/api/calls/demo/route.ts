/**
 * @module api/calls/demo
 *
 * Manual demo call from the dashboard. `GET` returns the number to prefill (`DEMO_TENANT_PHONE`);
 * `POST { phone }` rings that number with the demo tenancy. Signed-in users only.
 *
 * Depends on: next/server, @/utils/supabase/server, @/voice/demo-call
 * Used by: CallNowButton
 */

import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { isE164, placeDemoCall } from "@/voice/demo-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn(): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return Boolean(data.user);
}

/** Number to prefill in the call form. */
export async function GET() {
    if (!(await signedIn())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ defaultPhone: process.env.DEMO_TENANT_PHONE?.trim() ?? "" });
}

/**
 * Rings the demo call.
 *
 * @param request - JSON body `{ phone }` in E.164 format
 */
export async function POST(request: Request) {
    if (!(await signedIn())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: unknown = await request.json().catch(() => null);
    const raw = body && typeof body === "object" && "phone" in body ? body.phone : null;
    const phone = typeof raw === "string" ? raw.trim() : "";
    if (!isE164(phone)) {
        return NextResponse.json({ error: "Enter the number in international format, like +61416827278." }, { status: 400 });
    }

    try {
        const { roomName } = await placeDemoCall({ toPhoneNumber: phone });
        return NextResponse.json({ roomName, phone });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[api/calls/demo] dial failed:", message);
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
