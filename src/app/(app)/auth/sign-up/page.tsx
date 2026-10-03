/**
 * @module (app)/auth/sign-up/page
 *
 * Sign-up page. Renders SignUpForm.
 *
 * Depends on: SignUpForm, sign-in-return.
 * Used by: Next.js (route "/auth/sign-up").
 */

import { SignUpForm } from '@/components/auth/sign-up-form'
import { sanitizeSignInReturn } from '@/lib/sign-in-return'

type TPageProps = {
  searchParams: Promise<{ next?: string }> | { next?: string };
};

/** Sign-up page. Preserves Sign-in return for login link. */
export default async function Page(props: TPageProps) {
  const searchParams = await Promise.resolve(props.searchParams);
  const redirectPath = sanitizeSignInReturn(searchParams?.next);

  return <SignUpForm redirectPath={redirectPath} />
}
