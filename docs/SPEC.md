# Tech spec

**Status: locked** on 3 October 2026. This file is the source of truth. The other docs are the notes that produced it. If they disagree with this file, this file wins.

## Product

RentRecovery calls tenants about late rent, negotiates a plan inside the landlord’s limits, and collects the payment. It is for a property manager with many properties. When any invoice goes overdue, the agent starts itself.

Stripe tells the agent who to call, the agent fixes the balance inside Stripe, and Stripe pays the landlord. We bill the landlord for collection outcomes. We do not keep a cut of the rent.

## Build order

Build these until they work on stage:

1. A failed or overdue Stripe invoice starts the call.
2. Claude negotiates inside policy and writes the plan in Stripe.
3. The link goes out by Twilio SMS and Resend email. The judge pays. The agent confirms it live.
4. The landlord dashboard: login, an AppFolio connection that only displays details, portfolio, settings, calls.

Add if the four above are solid: Connect destination charges, and a usage charge on the demo call.

Leave for later: a real AppFolio API, payday alignment, ACH, Smart Retries, Financial Connections, and a full recovery analytics suite. Record the demo before the show.

## Systems

| System | Job |
| --- | --- |
| Stripe | Invoices, Subscription Schedules, credit notes, destination charges, outcome billing. Events start the call. |
| Supabase | Portfolio, policy, perks, calls, plans. Auth for the dashboard. The working copy the agent reads. |
| Vercel | Dashboard. `WorkflowAgent` starts calls and waits. `ToolLoopAgent` (Claude) negotiates. AI Gateway for Claude, Jev, and Gemini. |
| LiveKit | Audio only. Deepgram transcribes, Silero detects speech, ElevenLabs speaks. Each turn is sent to the `ToolLoopAgent`. LiveKit does not decide terms. |
| Jev (`typesafe-ai/jev`) | System One decision model. Low-latency judgment against constraints written before the call. |
| Twilio | SMS with the payment link. |
| Resend | Email with the same link. |
| Gemini | Reads a tenant photo into a short description. |

## Data

Production syncs landlords, properties, units, and tenancies from the property manager’s PMS. The demo seeds those rows in Supabase and shows them as imported from AppFolio. Nothing calls AppFolio.

Policy and perks are set on our dashboard. They are not copied from the PMS.

Stripe holds the money. There is no balance column in Supabase. The open amount is the Stripe invoice.

| Table | Holds | Written by |
| --- | --- | --- |
| `landlords` | Name, phone, `auth.users` id, Stripe customer id (our bill), Stripe connected account id (their rent), external PMS id | Sync or seed, plus Connect onboarding |
| `properties` | Name, address, `landlord_id`, external PMS id | Sync or seed |
| `units` | Label, `property_id`, external PMS id | Sync or seed |
| `tenancies` | Name, phone, email, language, `unit_id`, tenant Stripe customer id, external PMS id | Sync or seed |
| `policies` | `max_installments`, `grace_days`, `fee_waiver_cap`. One row per landlord | Settings screen |
| `perks` | Landlord-written sweetener and the condition that unlocks it | Settings screen |
| `calls` | Tenancy, Stripe invoice id, status, transcript, Jev probabilities, handoff reason, Twilio id, Resend id, photo path, Gemini summary | Agents |
| `plans` | Installments, dates, amounts, waiver, `perk_id`, Stripe Subscription Schedule id, `call_id` | Policy code, then the Stripe toolkit |

Row level security is on. The landlord’s browser session sees only their rows. Agents use the Supabase secret key on the server. That key is not in the dashboard.

## Call

1. Stripe reports `invoice.payment_failed` or an invoice past due, on any property. A later failed installment does the same, with that installment in the prompt.
2. `WorkflowAgent` maps the Stripe customer to a tenancy and places the call.
3. `ToolLoopAgent` loads the tenancy, policy, and perks from Supabase, and the invoice from Stripe.
4. The first spoken sentence discloses that this is an AI assistant for the property, then states the invoice balance.
5. Claude negotiates a plan: installment count, dates, amounts, a waiver, and at most one perk. `check_policy` accepts it or returns the nearest plan inside the settings. Claude says only that result.
6. Each tenant turn, `check_signals` sends the transcript, any photo summary, and the constraints to Jev. At or above 0.35 on hardship, dispute, or distress, the call stops and waits for a person.
7. On acceptance, `save_plan` writes a Subscription Schedule in Stripe and a credit note only inside the fee-waiver cap, then stores the plan in Supabase.
8. `send_payment_link` sends that Stripe link by Twilio and by Resend. One missing address sends the channel that exists.
9. When Stripe reports the payment, the agent confirms the amount on the call. The destination charge transfers the full rent to the landlord’s connected account.

Speech is one or two sentences. No JSON, ids, probabilities, or tool names.

Tools on the `ToolLoopAgent`: `load_tenancy`, `check_policy`, `check_signals`, `save_plan`, `send_payment_link`, `confirm_payment`, `read_photo`.

## Policy

Code enforces the numbers. Claude cannot cross them. Jev does not approve a dollar amount.

| Setting | Rule |
| --- | --- |
| Maximum installments | More splits are rejected. The counter-offer uses the maximum. |
| Grace window | A date outside the window is rejected. The counter-offer uses the last allowed date. |
| Fee-waiver cap | A waiver above the cap is rejected. Zero means no waiver. A credit note cannot exceed the cap. |
| Perks | One perk from this landlord’s list, and only when its condition matches the plan. |

A perk is a sentence the landlord wrote, such as “We’ll mow the lawn this weekend if you pay the open balance today.” The agent may say it warmly. It may not invent a favor.

## Jev

One request to `https://ai-gateway.vercel.sh/v1/evaluate`, model `typesafe-ai/jev`, zero data retention. Three boolean questions against the same state: hardship, dispute, distressed. Flag line is 0.35. A flagged dispute is acknowledged. The agent does not argue the ledger.

If AI Gateway is not ready in time, Claude answers the same three questions with a strict schema. The 0.35 rule and the policy code stay where they are.

Gemini writes a factual description of a hardship letter or a repair photo onto the call. That description is part of the next Jev state. Gemini does not set terms.

## Money

**Rent.** The tenant pays our checkout. Destination charge, Accounts v2. We are the merchant of record. Stripe transfers the full rent to that landlord’s connected account. We do not keep a cut.

**Our bill.** Outcomes-based, settled as usage through the [Machine Payments Protocol](https://docs.stripe.com/payments/machine). No seat fee. A current portfolio costs nothing. We count three outcomes: the agent places the call, the tenant accepts a plan, the payment clears. A Jev check or a tool call inside the turn is not a charge.

Link Agent Wallet is not in this product. It spends money. It does not collect rent.

## Dashboard

Vercel app. Supabase Auth, email and password. Five screens:

1. **Connection.** AppFolio shown as connected: account name, status, last sync, counts of properties, units, and tenancies. “Sync now” does not call AppFolio. Rows are the seeded records, labeled as imported.
2. **Portfolio.** Those properties and tenancies, each with the open Stripe invoice.
3. **Calls.** In progress, waiting on a person, or paid. Transcript, perk, and plan.
4. **Settings.** Policy limits and perks.
5. **Billing.** The three outcomes, from Stripe. Rent collected is listed apart from that bill.

The landlord does not edit the invoice and does not start the call.

## Demo

Second screen is the logged-in dashboard. An invoice is marked failed. The agent calls, names the property, discloses it is an AI, and states the balance. The judge asks for terms outside policy. The agent returns the allowed plan, with a perk if one fits. The judge agrees, receives the link by text and email, pays, and hears the confirmation. The dashboard moves to paid.

A recorded copy of that path plays if the live call, the message, or the webhook fails.

## Non-goals

- A second ledger beside Stripe.
- Claude granting a waiver, a date, a split, or a perk the policy tool did not return.
- The agent starting because a person pressed call.
- A live AppFolio integration in the demo.
- Taking a percentage of the rent.
