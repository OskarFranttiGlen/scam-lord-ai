# ScamLord AI

A rent collection agent that recovers more payments by making it easy for tenants to pay. It resolves late rent quickly and professionally with flexible plans, instant payment, and a respectful tone that keeps the tenant relationship strong.

Built-in safeguards make it trustworthy: upfront AI disclosure, landlord-set policy limits, hardship detection with a human handoff, and dispute handling.

## The problem

A voice agent calling tenants about late rent is weaker than a person at reading emotions, negotiating with judgment, handling hardship and disputes, earning trust, and staying compliant. It is stronger at scale, consistency, 24/7 availability, languages, record-keeping, and instant payment links.

The product leans on those strengths. Where a call needs judgment, Jev supplies it.

## How a call works

ScamLord AI is its own property system. Supabase stores the tenancy, the open balance, and the landlord’s limits. A Vercel `ToolLoopAgent` (Claude) negotiates from those rows. Jev is the System One model: the low-latency decision layer that judges each turn against constraints we define ahead of time. A Jev flag blocks the next concession and hands the call to a person. A Vercel `WorkflowAgent` waits on the Stripe payment or the human handoff when that outlasts the spoken turn. When the tenant agrees to a plan inside policy, the agent sends one Stripe link by Twilio SMS and by Resend email, then confirms payment on the live call. A plan can include a perk the landlord already wrote, such as mowing the lawn if they pay.

```
Supabase  tenancy, charges, policy, plan, payment, call
    │
    ▼
Vercel ToolLoopAgent (Claude) ── tools: policy, Jev, Stripe, Gemini
    │
    ▼
[LiveKit audio] ──► [Deepgram STT] ──► agent ──► [ElevenLabs] ──► audio out

Jev flag ──► handoff
Stripe or a person taking time ──► Vercel WorkflowAgent
Landlord settings + live status ──► Vercel dashboard, same Supabase rows
```

## Hackathon categories

| Bet | What judges should see |
| --- | --- |
| Stripe (deepest) | A judge plays the tenant. The agent negotiates a plan, sends a Stripe link by text and email mid-call, the judge pays, and the agent confirms the payment live. |
| Claude | The negotiation brain, working inside policy guardrails. |
| Gemini | Reads photos tenants send, such as a hardship letter or a repair issue. |
| Vercel | Hosts the dashboard and runs the agents: `ToolLoopAgent` on the call, `WorkflowAgent` for payment and handoff. Jev runs through AI Gateway. |
| Codex | Used visibly during the build. |
| UX | A clean landlord settings screen. |
| Backup | A recorded demo if the live call fails. |

## Specs

- [Property system](docs/pms.md) — Supabase records and the Vercel agents
- [Architecture](docs/architecture.md) — who decides what on a call
- [Safeguards](docs/safeguards.md) — code policy, Jev decisions, human handoff, Gemini
- [Voice agent](docs/voice-agent.md) — disclosure, prompt, tools, Stripe on the call
- [Demo](docs/demo.md) — live Stripe path and the recorded backup
