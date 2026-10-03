# Architecture

Supabase is the property system: tenancy, balance, policy, plan, payment, and call. The negotiation brain is a Vercel `ToolLoopAgent` with Claude as the model. Jev, a System One model, is the low-latency decision model. It gives the agent better judgment from constraints we pre-define. Numeric landlord limits stay in plain code. A Vercel `WorkflowAgent` finishes a Stripe payment or a human handoff when that waits past the spoken turn. Stripe collects the payment. Details are in [Property system](pms.md).

## Responsibilities

| Piece | Role on the call |
| --- | --- |
| Vercel `ToolLoopAgent` (Claude) | Talks with the tenant. Loads the tenancy from Supabase. Extracts dates, amounts, and reasons. Offers only plans the policy code allows. Phrases handoffs and payment confirmations for speech. |
| Policy code | Enforces landlord limits: maximum installment splits, grace-period window, fee-waiver cap. Accepts or counters a proposal with no model in the loop. |
| Jev (`typesafe-ai/jev`) | System One decision model. On each turn it judges the transcript against constraints we wrote in advance and returns a typed decision with a probability. Low latency, so it fits the voice loop. Code acts on the decision. |
| Gemini | Reads a photo the tenant sends (hardship letter, repair issue) and writes a short description into call state. |
| Stripe | One Checkout link, sent mid-call by Twilio SMS and Resend email. Payment confirmation returns to the agent before the call ends. |
| LiveKit | Audio in and out. Deepgram transcribes. ElevenLabs speaks. Forwards each turn to the `ToolLoopAgent` and speaks the reply. |
| Vercel `WorkflowAgent` | Durable wait for the Stripe webhook and for a person to take a handoff. |
| Vercel | Dashboard, both agents, and the AI Gateway path for Claude, Jev, and Gemini. |
| Supabase | The property records the agents read and write. |

## Call sequence

1. The agent discloses that it is an AI, then states the balance.
2. Claude negotiates a plan. Every offer is checked by policy code against the landlord’s settings.
3. On each tenant turn, code sends the transcript window and the pre-defined constraints to Jev. Jev returns a decision for hardship, dispute, and distress.
4. If a decision flags, Claude stops negotiating, tells the tenant a person will follow up, and the call is marked for human handoff.
5. If the tenant accepts a plan inside policy, Claude sends a Stripe link by SMS.
6. When Stripe reports the payment, Claude confirms the amount and that the balance is updated.
7. A photo, if one arrives, is read by Gemini and attached to the call. A hardship letter or a repair dispute feeds the same handoff path.

## What stays out of the model

Claude does not invent fee waivers, extra installments, or dates outside the grace window. Those bounds are exact, so code enforces them. Jev does not replace that arithmetic. It makes the judgment calls we can specify in advance, and it is tuned to over-flag because a missed hardship, dispute, or distress matters more than an extra handoff.

If wiring Jev through AI Gateway slips during the build, Claude answers the same three questions through a strict schema. Policy code does not move. The fallback is a build contingency, not a second policy engine.

## Ledger

The agent does not write the ledger in conversation. Policy code inserts a `plans` row when the tenant accepts. The Stripe webhook, finished by the `WorkflowAgent`, marks `charges` paid and updates `payments`. The dashboard reads those Supabase rows.
