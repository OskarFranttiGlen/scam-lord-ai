# ScamLord AI

A rent collection agent that recovers more payments by making it easy for tenants to pay. It resolves late rent quickly and professionally with flexible plans, instant payment, and a respectful tone that keeps the tenant relationship strong.

Built-in safeguards make it trustworthy: upfront AI disclosure, landlord-set policy limits, hardship detection with a human handoff, and dispute handling.

## The problem

A voice agent calling tenants about late rent is weaker than a person at reading emotions, negotiating with judgment, handling hardship and disputes, earning trust, and staying compliant. It is stronger at scale, consistency, 24/7 availability, languages, record-keeping, and instant payment links.

The product leans on those strengths. It is built for a landlord or property manager with many properties: when any invoice goes overdue, the agent starts itself. Where a call needs judgment, Jev supplies it.

## How a call works

Stripe tells the agent who to call. An `invoice.payment_failed` event, or an invoice past due, starts a Vercel `WorkflowAgent`, which places the call with that invoice’s property and amount. A later failed installment starts another call with that context.

Supabase stores the tenancy, the landlord’s limits, and the perks. In production the portfolio syncs from the property manager’s PMS. For the demo those rows are seeded in Supabase. Stripe holds the invoice, the installment schedule, and the payout. A Vercel `ToolLoopAgent` (Claude) negotiates on the call and writes the plan back into Stripe through the Agent Toolkit. Jev is the System One model: the low-latency decision layer that judges each turn against constraints we define ahead of time. A Jev flag blocks the next concession and hands the call to a person. When the tenant agrees, the agent sends one Stripe link by Twilio SMS and by Resend email, then confirms payment on the live call. A plan can include a perk the landlord already wrote, such as mowing the lawn if they pay.

```
Stripe invoice overdue or payment_failed
    │
    ▼
Vercel WorkflowAgent ── starts the call (any property in the portfolio)
    │
    ▼
Supabase  tenancy, policy, perks, call
    │
    ▼
Vercel ToolLoopAgent (Claude) ── tools: policy, Jev, Stripe Toolkit, Gemini
    │
    ▼
[LiveKit audio] ──► [Deepgram STT] ──► agent ──► [ElevenLabs] ──► audio out

Agreed plan ──► Stripe Subscription Schedule + optional credit note
Link ──► Twilio SMS + Resend email
Jev flag ──► handoff
Payout ──► landlord’s Stripe connected account
```

## Hackathon categories

| Bet | What judges should see |
| --- | --- |
| Stripe (deepest) | An overdue invoice starts the call on its own. The agent negotiates inside Stripe, sends the link by text and email, the judge pays, and the agent confirms it live. |
| Claude | The negotiation brain, working inside policy guardrails. |
| Gemini | Reads photos tenants send, such as a hardship letter or a repair issue. |
| Vercel | Hosts the dashboard and runs the agents: `ToolLoopAgent` on the call, `WorkflowAgent` for payment and handoff. The agent floor shows live run status and a React Flow graph of the current step, with the Jev trace for each decision. Jev runs through AI Gateway. |
| Codex | Used visibly during the build. |
| UX | A landlord logs in and sees their portfolio and settings. |
| Backup | A recorded demo if the live call fails. |

## Specs

- [Stripe](docs/stripe.md) — events start the call, the agent writes the plan in Stripe, each landlord is billed for collection outcomes
- [Property system](docs/pms.md) — Supabase records and the Vercel agents
- [Architecture](docs/architecture.md) — who decides what on a call
- [Safeguards](docs/safeguards.md) — code policy, Jev decisions, human handoff, Gemini
- [Voice agent](docs/voice-agent.md) — disclosure, prompt, tools, Stripe on the call
- [Dashboard](docs/dashboard.md) — landlord login, AppFolio connection, portfolio, settings, calls, billing, and the agent floor
- [Demo](docs/demo.md) — live Stripe path and the recorded backup
