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

  return (
    <div className="bg-white dark:bg-darkGray flex flex-row sm:min-h-svh w-full items-center justify-around gap-24 md:p-10">
      <div className="w-full pr-12 max-sm:pr-0 max-w-md">
        <LoginForm redirectPath={next} />
      </div>
      <div className="w-[50%] relative max-sm:hidden min-h-[40vh]">
        <div className="absolute z-0 w-[40%] h-[35%] top-0 pink__gradient" />
        <div className="absolute z-1 w-[80%] h-[80%] rounded-full white__gradient bottom-40" />
        <div className="absolute z-0 w-[50%] h-[50%] right-20 bottom-20 blue__gradient" />
      </div>
    </div>
  )
}
