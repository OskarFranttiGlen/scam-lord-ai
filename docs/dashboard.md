# Landlord dashboard

A landlord logs in and sees their own portfolio. The app is a small Vercel site. Supabase Auth is the login. Row level security limits every query to that landlord.

The demo account is seeded. Production uses the same login after the PMS sync has created the landlord row.

## Login

Email and password. The session is the Supabase user on `landlords.auth user`. A signed-out visit lands on the login screen. There is no public portfolio view.

## After login

Four screens. That is the whole app.

**Portfolio.** Properties, units, and tenancies synced from their PMS (seeded for the demo). Each tenancy shows the open Stripe invoice: amount, due date, and status. This is the screen that proves the agent watches more than one property.

**Calls.** Calls for those tenancies. Status is one of in progress, waiting on a person, or paid. Opening a call shows the transcript, any perk offered, and the plan. A handoff sits here until someone takes it.

**Settings.** The limits the agent is allowed to offer: maximum installments, grace-period days, fee-waiver cap. Perks live here too, each with the condition that unlocks it. Saving writes `policies` and `perks`. The next call reads those rows.

**Billing.** Outcomes billed to this landlord: calls placed, plans accepted, payments cleared. The amounts come from Stripe. The rent collected is listed separately and is not part of this bill.

## What the landlord cannot do here

They do not edit the ledger. The balance is the Stripe invoice. They do not start the call by hand. An overdue invoice does that. They do not see another landlord’s rows.
