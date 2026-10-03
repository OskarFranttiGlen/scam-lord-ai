/**
 * @module (app)/auth/sign-up-success/page
 *
 * Post sign-up success page. Card instructing user to check email to confirm.
 * Sits at src/app/(app)/auth/sign-up-success/page.tsx; route "/auth/sign-up-success".
 *
 * Depends on: Card components.
 * Used by: Next.js (route "/auth/sign-up-success").
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/** Sign-up success; confirm-email message. */
export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Thank you for signing up!</CardTitle>
        <CardDescription>Check your email to confirm</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          You&apos;ve successfully signed up. Please check your email to confirm your account
          before signing in.
        </p>
      </CardContent>
    </Card>
  )
}
