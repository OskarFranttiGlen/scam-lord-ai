# Tech spec

**Status: locked** on 3 October 2026. This file is the source of truth. The other docs are the notes that produced it. If they disagree with this file, this file wins.

## Product

RentRecovery calls tenants about late rent, negotiates a plan inside the landlord’s limits, and collects the payment. It is for a property manager with many properties. When any invoice goes overdue, the agent starts itself.

Stripe tells the agent who to call, the agent fixes the balance inside Stripe, and Stripe pays the landlord. We bill the landlord for collection outcomes. We do not keep a cut of the rent.

## Build order

Build these until they work on stage:

1. A failed or overdue Stripe invoice starts the call.
2. Claude negotiates inside policy and writes the plan in Stripe.
3. The link goes out by Twilio SMS and Resend email. The judge pays. The agent confirms it live. The tenant can reply to the text or call the number back and reach the same agent.
4. The landlord dashboard: login, an AppFolio connection that only displays details, portfolio, settings, calls.

Add if the four above are solid: Connect destination charges, and a usage charge on the demo call.

Leave for later: a real AppFolio API, payday alignment, ACH, Smart Retries, Financial Connections, and a full recovery analytics suite. Record the demo before the show.

## Systems

| System | Job |
| --- | --- |
| Stripe | Invoices, installment invoices, credit notes, destination charges, outcome billing. Events start the call. |
| Supabase | Portfolio, policy, perks, calls, plans. Auth for the dashboard. The working copy the agent reads. |
| Vercel | Dashboard. `WorkflowAgent` starts calls and waits. `ToolLoopAgent` (Claude) negotiates on every channel. AI Gateway for Claude, Jev, and Gemini. |
| LiveKit | Audio only. Deepgram transcribes, Silero detects speech, ElevenLabs speaks. Each turn is sent to the `ToolLoopAgent`. LiveKit does not decide terms. Phone audio reaches LiveKit over SIP trunks to Twilio, outbound and inbound. LiveKit does not send texts. |
| Jev (`typesafe-ai/jev`) | System One decision model. Low-latency judgment against constraints written before the call. |
| Twilio | One number per property manager for everything: the outbound call, the payment-link text, the tenant's text replies, and callbacks. Voice runs over an Elastic SIP Trunk into LiveKit. |
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
| `calls` | Tenancy, channel (outbound call, callback, or text), Stripe invoice id, status, transcript, Jev probabilities, handoff reason, Twilio id, Resend id, photo path, Gemini summary, `ai_notes` (summary and promised payment dates) | Agents |
| `plans` | Installments, dates, amounts, waiver, `perk_id`, Stripe installment invoice ids, `call_id` | Policy code, then the Stripe toolkit |
| `maintenance_requests` | Repairs per tenancy: description, status, urgency, optional appointment window, source call | Agents during check-in |
| `office_tasks` | Follow-ups for the office: type, details, due date, `collection_paused_until`, Stripe invoice id, source call, status | Agents during a conversation |

Row level security is on. The landlord’s browser session sees only their rows. Agents use the Supabase secret key on the server. That key is not in the dashboard.

## Call

1. Stripe reports `invoice.payment_failed` or an invoice past due, on any property. A later failed installment does the same, with that installment in the prompt.
2. `WorkflowAgent` maps the Stripe customer to a tenancy and places the call.
3. `ToolLoopAgent` loads the tenancy, policy, and perks from Supabase, and the invoice from Stripe.
4. Fixed call opening. The greeting asks for the tenant and names the caller, with no amounts: "Hi, is this {first_name}? This is RentRecovery, calling for {manager}." `{manager}` is the landlord's name, falling back to the property name. Once they confirm, one turn, word for word: a repair update only when a repair is booked ("Quick update first: your {repair} is booked for {day}."), the pivot ("The main reason I'm calling is your rent."), one ledger line, and the ask ("Can you take care of it today?"). Ledger lines: repeated late ("{month}'s {amount} is unpaid, and {two prior months} both came in late."), carried over ("There's {amount} unpaid going back to {month}."), or first time ("{month}'s {amount} is unpaid."). The ledger comes from the customer's recent Stripe invoices: open past due is unpaid, paid after the due date is late. The repair is never tied to the rent. A tenant who returns to the repair hears one line ("That's booked either way. Now, about the {amount}.") and the ask again. "I'll pay when it's fixed" opens an `urgent_repair` office task (scenario D4). No threats: eviction, credit, legal. The agent does not call itself an AI unprompted, but if asked whether it is a person it says it is an AI assistant and never claims to be human. Calls have no check-in question; a repair the tenant raises is still logged with `record_feedback`.
5. Claude negotiates a plan: installment count, dates, amounts, a waiver, and at most one perk. `check_policy` accepts it or returns the nearest plan inside the settings. Claude says only that result.
6. Each tenant turn, Jev checks the transcript, any photo summary, maintenance history, and the constraints, in parallel with Claude. By default, at or above 0.35 on hardship, dispute, or distress, the agent stops negotiating and waits for a person. When `SCAMLORD_PLAYBOOK_MODE` is set, the same flags select a playbook script (hardship, dispute, or distress) and the agent keeps negotiating inside that script. Five stop cases always end with a person: safety (988), a second request for a person, legal matter, protected circumstance, and repair escalation when a lawyer or inspector is mentioned. Urgent maintenance from the check-in also hands off. A handoff holds for the rest of the conversation, on every channel.
7. On acceptance, `accept_plan` re-checks policy, writes one Stripe invoice per installment, closes the overdue invoice with credit notes (the waiver credit stays inside the cap), and stores the plan in Supabase.
8. It then sends the first installment's Stripe link by Twilio and by Resend. One missing address sends the channel that exists. The text invites a reply.
9. When Stripe reports the payment, the agent confirms the amount on the call. The destination charge transfers the full rent to the landlord’s connected account.

Speech is one or two sentences. No JSON, ids, probabilities, or tool names.

Tools on the `ToolLoopAgent`: `record_feedback`, `record_closing_feedback`, `create_office_task`, `send_assistance_referral`, `check_policy`, `accept_plan`, `confirm_payment`, `read_photo`. Jev is not a tool; it runs on every turn. `check_policy` and `accept_plan` stay locked until `record_feedback` runs on new text threads (calls have no check-in).

Follow-up notes: after each call, a model writes `calls.ai_notes`, a one- or two-sentence summary plus the payment dates the tenant promised. Dates from an accepted plan are added in code. The next call loads notes from the tenancy's last five conversations. A promised date that passed while the balance is still owed is a broken promise. At two or more, the agent names the missed dates once, neutrally, offers no new plan, and asks for the full balance today. `check_policy` and `accept_plan` refuse anything else. If the tenant cannot pay, the agent opens a `missed_promises` office task.

`create_office_task` opens a follow-up due tomorrow; code sets the date. Types: `payment_match`, `disputed_line`, `assistance_paperwork`, `tenant_portion`, `move_out_deposit`, `confirm_claim`, `urgent_repair`, `lease_change`, `tenancy_at_risk`, `missed_promises`. While a `payment_match` or `disputed_line` task is open, `accept_plan` refuses and no payment link goes out. The first six types also pause collection: the Stripe webhook does not start a new call on that invoice before `collection_paused_until`.

The scenario tables from the Oct 2026 playbook (Chuck Hattemer) are the design target.

## Text

The tenant can reply to the payment-link text, or text the number first.

1. Twilio posts the message to our webhook. The webhook checks Twilio's signature.
2. The sender's number maps to a tenancy. An unknown number gets a short reply that someone from the property will follow up, and no account details.
3. The same `ToolLoopAgent` answers, with the same policy code, Jev check, and tools. Replies are written for a phone screen: short, plain, and they may include the payment link.
4. One text conversation per tenancy, stored as a `calls` row with channel text. A handoff on the call carries into text, and the reverse.
5. STOP and HELP are Twilio's. The agent does not text a number that opted out.

## Callback

The tenant can call the same number back.

1. Twilio sends the inbound call over the SIP trunk to LiveKit. A dispatch rule starts the agent.
2. The caller's number maps to a tenancy. The agent greets them as RentRecovery for the manager, then picks up where the last conversation left off.
3. An unknown caller hears no balance or account details. The agent takes a name and says someone will call back.
4. The rest is the call above, stored as a `calls` row with channel callback.

LiveKit Phone Numbers can answer callbacks if Twilio is not set up. They do not dial out or text.

## Policy

Code enforces the numbers. Claude cannot cross them. Jev does not approve a dollar amount.

| Setting | Rule |
| --- | --- |
| Maximum installments | More splits are rejected. The counter-offer uses the maximum. |
| Grace window | A date outside the window is rejected. The counter-offer uses the last allowed date. |
| Fee-waiver cap | A waiver above the cap is rejected. Zero means no waiver. A credit note cannot exceed the cap. A waiver comes off what is owed: installments add up to the balance minus the waiver. |
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
