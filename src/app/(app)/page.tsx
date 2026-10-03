/**
 * @module (app)/page
 *
 * Home page route. Renders the hero Prompt only (ADR 0033 slice 1).
 * Sits at src/app/(app)/page.tsx; entry for "/" within the (app) segment.
 *
 * Depends on: Prompt, createClient (Supabase server).
 * Used by: Next.js (route "/").
 */

import { Prompt } from '@/components/artifact-builder/shared/Prompt';
import { createClient } from "@/utils/supabase/server";

export function generateStaticParams() {
  return [{ slug: [''] }];
}

/** Server component for the home page. Fetches current user and passes to Prompt. */
export default async function Page() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    return (
        <Prompt userData={user} />
    );
}
