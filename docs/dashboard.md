# Landlord dashboard

A landlord logs in and sees their own portfolio. The app is a small Vercel site. Supabase Auth is the login. Row level security limits every query to that landlord.

The demo account is seeded. The AppFolio connection on screen is display only: it shows the details of a connected account and does not call AppFolio. Production uses the same login after a real PMS sync has created the landlord row.

## Login

Email and password. The session is the Supabase user on `landlords.auth user`. A signed-out visit lands on the login screen. There is no public portfolio view.

## After login

Five screens. That is the whole app.

**Connection.** AppFolio, shown as connected. The screen lists the account name, the connected status, when it last synced, and the counts it brought in: properties, units, and tenancies. A button reads “Sync now” and does not hit AppFolio. The rows under it are the seeded Supabase records, labeled as imported from AppFolio.

**Portfolio.** Those same properties, units, and tenancies. Each tenancy shows the open Stripe invoice: amount, due date, and status. This is the screen that proves the agent watches more than one property.

**Calls.** Calls for those tenancies. Status is one of in progress, waiting on a person, or paid. Opening a call shows the transcript, any perk offered, and the plan. A handoff sits here until someone takes it.

**Settings.** The limits the agent is allowed to offer: maximum installments, grace-period days, fee-waiver cap. Perks live here too, each with the condition that unlocks it. Saving writes `policies` and `perks`. The next call reads those rows.

**Billing.** Outcomes billed to this landlord: calls placed, plans accepted, payments cleared. The amounts come from Stripe. The rent collected is listed separately and is not part of this bill.

## What the landlord cannot do here

They do not edit the ledger. The balance is the Stripe invoice. They do not start the call by hand. An overdue invoice does that. They do not see another landlord’s rows.
