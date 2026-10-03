/**
 * @module (app)/auth/login/page
 *
 * Login page. Renders LoginForm with optional redirect path from query.
 *
 * Depends on: LoginForm, sign-in-return.
 * Used by: Next.js (route "/auth/login").
 */

import { LoginForm } from '@/components/auth/login-form'
import { sanitizeSignInReturn } from '@/lib/sign-in-return'

type TPageProps = {
  searchParams: Promise<{ next?: string }> | { next?: string };
};

/**
 * Login page; passes next (redirect) from search params to LoginForm.
 *
 * @param props - Page props; searchParams may be Promise or plain object (Next compat).
 */
export default async function Page(props: TPageProps) {
  const searchParams = await Promise.resolve(props.searchParams);
  const next = sanitizeSignInReturn(searchParams?.next);

  return <LoginForm redirectPath={next} />
}
