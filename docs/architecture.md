# Architecture

Supporting note. The locked spec is [SPEC.md](SPEC.md).

Stripe is the money system. An overdue or failed invoice starts the call, across every property, with no one pressing a button. The negotiation brain is a Vercel `ToolLoopAgent` with Claude as the model, and it operates Stripe through the Agent Toolkit during the call. Jev, a System One model, is the low-latency decision model. It gives the agent better judgment from constraints we pre-define. Numeric landlord limits stay in plain code. A Vercel `WorkflowAgent` starts the call from the Stripe event and also waits on payment or a human handoff. Supabase holds the property context Stripe does not. That portfolio syncs from the property manager’s PMS. The demo seeds the same tables. Details are in [Stripe](stripe.md) and [Property system](pms.md).

## Responsibilities

| Piece | Role on the call |
| --- | --- |
| Vercel `ToolLoopAgent` (Claude) | Talks with the tenant. Loads the tenancy from Supabase. Extracts dates, amounts, and reasons. Offers only plans the policy code allows. Phrases handoffs and payment confirmations for speech. |
| Policy code | Enforces landlord limits: maximum installment splits, grace-period window, fee-waiver cap. Accepts or counters a proposal with no model in the loop. |
| Jev (`typesafe-ai/jev`) | System One decision model. On each turn it judges the transcript against constraints we wrote in advance and returns a typed decision with a probability. Low latency, so it fits the voice loop. Code acts on the decision. |
| Gemini | Reads a photo the tenant sends (hardship letter, repair issue) and writes a short description into call state. |
| Stripe | System of record for invoices, Subscription Schedules, credit notes, and payouts. Events start the call. The agent reads and writes Stripe during the call. The link goes out by Twilio and Resend. |
| LiveKit | Audio in and out. Deepgram transcribes. ElevenLabs speaks. Forwards each turn to the `ToolLoopAgent` and speaks the reply. |
| Vercel `WorkflowAgent` | Starts a call when a Stripe invoice fails or is overdue, on any property. Also waits for payment confirmation and for a person to take a handoff. |
| Vercel | Landlord dashboard, the agent floor, both agents, and the AI Gateway path for Claude, Jev, and Gemini. |
| Supabase | The property records the agents read and write. |

## Call sequence

1. A Stripe invoice fails or goes overdue. The workflow starts the call for that tenancy. A failed later installment does the same, with the installment in the prompt.
2. The agent discloses that it is an AI, then states the balance from the Stripe invoice.
3. Claude negotiates a plan and writes an allowed schedule, and any allowed credit note, back to Stripe. Every offer is checked by policy code against the landlord’s settings.
4. On each tenant turn, code sends the transcript window and the pre-defined constraints to Jev. Jev returns a decision for hardship, dispute, and distress.
5. If a decision flags, Claude stops negotiating, tells the tenant a person will follow up, and the call is marked for human handoff.
6. If the tenant accepts a plan inside policy, Claude sends the Stripe link by Twilio SMS and Resend email.
7. When Stripe reports the payment, Claude confirms the amount. The destination charge is paid, and Connect transfers the rent to that landlord.
8. A photo, if one arrives, is read by Gemini and attached to the call. A hardship letter or a repair dispute feeds the same handoff path.

## What stays out of the model

Claude does not invent fee waivers, extra installments, or dates outside the grace window. Those bounds are exact, so code enforces them. Jev does not replace that arithmetic. It makes the judgment calls we can specify in advance, and it is tuned to over-flag because a missed hardship, dispute, or distress matters more than an extra handoff.

If wiring Jev through AI Gateway slips during the build, Claude answers the same three questions through a strict schema. Policy code does not move. The fallback is a build contingency, not a second policy engine.

## Agent floor

The same Vercel app has a page for the runs themselves, separate from the landlord screens. It shows which `ToolLoopAgent` and `WorkflowAgent` runs are in progress, and a [React Flow](https://reactflow.dev/) graph of the step each one is on. The trace under a run is the Jev request and the typed decision, so a bad flag or a missed one points at the constraint text we would change. Details are in [Dashboard](dashboard.md).

## Ledger

The agent does not invent the ledger in conversation. The open balance is the Stripe invoice. Policy code must allow a Subscription Schedule or a credit note before the toolkit writes it. Supabase keeps the call, the perk, and the tenancy the invoice belongs to. The recovery dashboard reads Stripe.
