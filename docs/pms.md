# Property system

Supporting note. The locked spec is [SPEC.md](SPEC.md).

ScamLord AI is the collection layer on top of a property manager’s existing system. It keeps the slice of that portfolio the agent needs: landlords, properties, units, and tenancies. In production those rows sync from their PMS. For the demo the dashboard shows an AppFolio connection with account name, status, last sync, and the imported counts. The data under it is seeded in Supabase. Nothing calls AppFolio. Stripe holds the money: invoices, installment schedules, credit notes, and payouts. See [Stripe](stripe.md).

Policy limits and perks are ours. They are set on the dashboard, not copied from the PMS.

The dashboard and the agents run on Vercel. LiveKit still carries the phone audio. Both read and write the same Supabase project.

## What the agent loads

At the start of a call the agent gets one tenancy and that landlord’s policy. That is enough to speak:

- Tenant name, mobile number, email, and language
- Property name and unit
- The open Stripe invoice: balance, late fee, due date, and which property it belongs to
- Policy limits: maximum installments, grace-period days, fee-waiver cap
- Perks the landlord is willing to throw in, such as mowing the lawn if the tenant pays
- Any open payment plan
- Whether a human handoff is already waiting

Anything the model says about money comes from the Stripe invoice. Claude does not invent a balance.

## Tables

All of these live in Supabase Postgres. Row level security is on. The landlord’s browser session can read and edit only their own rows. The voice worker and the Vercel agents use the secret key on the server. That key never ships to the dashboard.

| Table | What it stores | Who writes it |
| --- | --- | --- |
| `landlords` | Name, phone, link to `auth.users`, Stripe customer id (usage billing), Stripe connected account id (rent payouts), external PMS id | PMS sync. Demo: seeded |
| `properties` | Name, address, `landlord_id`, external PMS id | PMS sync. Demo: seeded |
| `units` | Label, `property_id`, external PMS id | PMS sync. Demo: seeded |
| `tenancies` | Tenant name, phone, email, language, `unit_id`, Stripe customer id, external PMS id | PMS sync. Demo: seeded |
| `policies` | `max_installments`, `grace_days`, `fee_waiver_cap`, one row per landlord | Landlord settings screen |
| `perks` | A landlord-written sweetener and when it applies. Example: “We’ll mow the lawn this weekend” if they pay the open balance today | Landlord |
| `calls` | Tenancy, Stripe invoice id, status, transcript, each Jev check (window, criteria, probabilities, outcome), handoff reason | Voice agent, started by a Stripe event |
| `plans` | Installments, dates, amounts, waiver, chosen `perk_id`, Stripe Subscription Schedule id, `call_id` | Policy code, then the Stripe toolkit |

Photos go in a private Storage bucket. The row on `calls` keeps the object path and the Gemini summary.

There is no second balance table. The open amount is the Stripe invoice on that customer. A failed or overdue invoice is what spins the agent up, including a later installment on a plan.

## Vercel agents

Two agents, both on the AI SDK, both through AI Gateway.

**`ToolLoopAgent`** is the in-call negotiation brain. Claude is the model. Each tenant turn is one agent run. Tools:

- `load_tenancy` reads the Supabase rows above
- `check_policy` runs the numeric limits in code
- `check_signals` calls Jev
- `save_plan` writes an allowed Subscription Schedule in Stripe, stores the id and any perk in Supabase, and issues a credit note only inside the fee-waiver cap
- `send_payment_link` takes the Stripe-hosted link, texts it with Twilio, and emails it with Resend
- `read_photo` asks Gemini and stores the summary

The LiveKit worker sends the transcript in and speaks the agent’s text out. The worker does not decide terms.

**`WorkflowAgent`** is the durable agent. It covers work that can outlast a single turn:

- Starting a call when Stripe reports `invoice.payment_failed` or an invoice past due, for any property on the account
- Waiting on the payment webhook, then confirming on the live call
- Parking a hardship, dispute, or distress handoff until a person takes it

Tools that wait on a person use `needsApproval`. The workflow suspends and the dashboard shows the call as waiting.

## Call path

1. Stripe reports a failed or overdue invoice on any property. A failed installment later does the same.
2. `WorkflowAgent` resolves the Stripe customer to a tenancy and starts the call.
3. `ToolLoopAgent` loads the tenancy, policy, and perks from Supabase, and the invoice from Stripe.
4. LiveKit plays the disclosure and the balance from that invoice.
5. The agent negotiates a payment plan inside the policy limits, writes it to Stripe, and may attach one perk from `perks`. On acceptance it sends the same Stripe link by Twilio SMS and by Resend email.
6. `WorkflowAgent` finishes the payment or the handoff if it lands after the spoken turn. Connect settles the rent to that landlord’s connected account.
7. The dashboard reads Stripe for recovered dollars and Supabase for the call, so the landlord sees both as they happen.
