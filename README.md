# ScamLord AI

A rent collection agent that recovers more payments by making it easy for tenants to pay. It resolves late rent quickly and professionally with flexible plans, instant payment, and a respectful tone that keeps the tenant relationship strong.

Built-in safeguards make it trustworthy: upfront AI disclosure, landlord-set policy limits, hardship detection with a human handoff, and dispute handling.

## The problem

A voice agent calling tenants about late rent is weaker than a person at reading emotions, negotiating with judgment, handling hardship and disputes, earning trust, and staying compliant. It is stronger at scale, consistency, 24/7 availability, languages, record-keeping, and instant payment links.

The product leans on those strengths. Where a call needs judgment, Jev supplies it.

## How a call works

Claude negotiates. Jev is the System One model: the low-latency decision layer that judges each turn against constraints we define ahead of time. Those constraints are the questions and criteria we write before the call (hardship, dispute, distress) plus the landlord’s numeric limits, which plain code enforces exactly. A Jev flag blocks the next concession and hands the call to a person. When the tenant agrees to a plan inside policy, the agent texts a Stripe link and confirms payment on the live call.

```
[LiveKit audio] ──► [Deepgram STT]
                         │
                         ▼
                   ┌───────────┐
                   │  Claude   │  Negotiate inside code policy
                   └─────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   Policy in code    Jev decides    Stripe link
   (landlord limits) hardship?      text mid-call,
                     dispute?       confirm when paid
                     distressed?
          │              │
          │              └── flag → block + human handoff
          ▼
   [ElevenLabs TTS] ──► [LiveKit audio out]

Photos (hardship letter, repair) ──► Gemini ──► call state
Landlord settings + live status ──► Vercel dashboard
```

## Hackathon categories

| Bet | What judges should see |
| --- | --- |
| Stripe (deepest) | A judge plays the tenant. The agent negotiates a plan, texts a Stripe link mid-call, the judge pays, and the agent confirms the payment live. |
| Claude | The negotiation brain, working inside policy guardrails. |
| Gemini | Reads photos tenants send, such as a hardship letter or a repair issue. |
| Vercel | Hosts the live dashboard. Jev runs through AI Gateway on the same platform. |
| Codex | Used visibly during the build. |
| UX | A clean landlord settings screen. |
| Backup | A recorded demo if the live call fails. |

## Specs

- [Architecture](docs/architecture.md) — who decides what on a call
- [Safeguards](docs/safeguards.md) — code policy, Jev decisions, human handoff, Gemini
- [Voice agent](docs/voice-agent.md) — disclosure, prompt, tools, Stripe on the call
- [Demo](docs/demo.md) — live Stripe path and the recorded backup
