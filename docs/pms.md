# Property system

ScamLord AI is its own property management system. Supabase holds the basic records the agent needs to place a call, negotiate inside the landlord’s limits, and write back a plan or a payment. It is not a full accounting suite.

The dashboard and the agents run on Vercel. LiveKit still carries the phone audio. Both read and write the same Supabase project.

## What the agent loads

At the start of a call the agent gets one tenancy and that landlord’s policy. That is enough to speak:

- Tenant name, mobile number, email, and language
- Property name and unit
- Monthly rent, open balance, late fee, and due date
- Policy limits: maximum installments, grace-period days, fee-waiver cap
- Perks the landlord is willing to throw in, such as mowing the lawn if the tenant pays
- Any open payment plan
- Whether a human handoff is already waiting

Anything the model says about money comes from these rows. Claude does not invent a balance.

## Tables

All of these live in Supabase Postgres. Row level security is on. The landlord’s browser session can read and edit only their own rows. The voice worker and the Vercel agents use the secret key on the server. That key never ships to the dashboard.

| Table | What it stores | Who writes it |
| --- | --- | --- |
| `landlords` | Name, phone, link to `auth.users` | Signup |
| `properties` | Name, address, `landlord_id` | Landlord |
| `units` | Label, `property_id` | Landlord |
| `tenancies` | Tenant name, phone, email, language, monthly rent, due day, `unit_id` | Landlord |
| `charges` | Rent or late fee, amount, due date, status (`open`, `paid`, `waived`) | Landlord, or the Stripe webhook when a charge is paid |
| `policies` | `max_installments`, `grace_days`, `fee_waiver_cap`, one row per landlord | Landlord settings screen |
| `perks` | A landlord-written sweetener and when it applies. Example: “We’ll mow the lawn this weekend” if they pay the open balance today | Landlord |
| `calls` | Tenancy, status, transcript, Jev probabilities, handoff reason | Voice agent |
| `plans` | Installments, dates, amounts, waiver, chosen `perk_id`, status, `call_id` | Policy code, after the tenant accepts |
| `payments` | Amount, Stripe Checkout session id, status, `plan_id`, Twilio message id, Resend email id | Agent creates the session and sends the link. The Stripe webhook marks it paid |

Photos go in a private Storage bucket. The row on `calls` keeps the object path and the Gemini summary.

Open balance is the sum of `charges` still `open` for that tenancy. The agent reads that number. It does not keep a second balance column.

## Vercel agents

Two agents, both on the AI SDK, both through AI Gateway.

**`ToolLoopAgent`** is the in-call negotiation brain. Claude is the model. Each tenant turn is one agent run. Tools:

- `load_tenancy` reads the Supabase rows above
- `check_policy` runs the numeric limits in code
- `check_signals` calls Jev
- `save_plan` inserts a `plans` row, including any perk, after the tenant accepts
- `send_payment_link` creates one Stripe Checkout session, texts it with Twilio, and emails it with Resend
- `read_photo` asks Gemini and stores the summary

The LiveKit worker sends the transcript in and speaks the agent’s text out. The worker does not decide terms.

**`WorkflowAgent`** is the durable agent. It covers work that can outlast a single turn:

- Waiting on the Stripe webhook, then marking charges paid and letting the live call confirm
- Parking a hardship, dispute, or distress handoff until a person takes it

Tools that wait on a person use `needsApproval`. The workflow suspends and the dashboard shows the call as waiting.

## Call path

1. A tenancy has an open charge past its due date.
2. The dashboard, or a scheduled job, starts a call with that `tenancy_id`.
3. `ToolLoopAgent` loads the tenancy, charges, and policy from Supabase.
4. LiveKit plays the disclosure and the balance from those rows.
5. The agent negotiates a payment plan inside the policy limits and may attach one perk from `perks`. On acceptance it sends the same Stripe link by Twilio SMS and by Resend email.
6. `WorkflowAgent` finishes the payment or the handoff if it lands after the spoken turn.
7. The dashboard reads the same tables, so the landlord sees the plan and the payment as they happen.
