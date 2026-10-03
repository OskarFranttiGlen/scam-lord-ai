/**
 * @module (app)/auth/forgot-password/page
 *
 * Forgot-password page. Form plus gradient chrome.
 *
 * Depends on: ForgotPasswordForm.
 * Used by: Next.js (route "/auth/forgot-password").
 */

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

/** Forgot-password page; form and gradient side panel. */
export default function Page() {
  return (
    <div className="bg-white dark:bg-darkGray flex flex-row sm:min-h-svh w-full items-center justify-around gap-24 md:p-10">
      <div className="w-full pr-12 max-sm:pr-0 max-w-md">
        <ForgotPasswordForm />
      </div>
      <div className="w-[50%] relative max-sm:hidden min-h-[40vh]">
        <div className="absolute z-0 w-[40%] h-[35%] top-0 pink__gradient" />
        <div className="absolute z-1 w-[80%] h-[80%] rounded-full white__gradient bottom-40" />
        <div className="absolute z-0 w-[50%] h-[50%] right-20 bottom-20 blue__gradient" />
      </div>
    </div>
  )
}
