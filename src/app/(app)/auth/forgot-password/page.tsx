/**
 * @module (app)/auth/forgot-password/page
 *
 * Forgot-password page.
 *
 * Depends on: ForgotPasswordForm.
 * Used by: Next.js (route "/auth/forgot-password").
 */

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

/** Forgot-password page; form only. */
export default function Page() {
  return <ForgotPasswordForm />
}
