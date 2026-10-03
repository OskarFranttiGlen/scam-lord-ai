/**
 * @module (app)/auth/update-password/page
 *
 * Update-password page (e.g. post reset link). Renders UpdatePasswordForm only.
 * Sits at src/app/(app)/auth/update-password/page.tsx; route "/auth/update-password".
 *
 * Depends on: UpdatePasswordForm.
 * Used by: Next.js (route "/auth/update-password").
 */

import { UpdatePasswordForm } from '@/components/auth/update-password-form'

/** Update-password page; form only. */
export default function Page() {
  return <UpdatePasswordForm />
}
