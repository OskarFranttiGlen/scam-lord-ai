# Safeguards

Four safeguards ship with the pitch: upfront AI disclosure, landlord-set policy limits, hardship detection with a human handoff, and dispute handling. Distress is a third decision on the same path as hardship and dispute.

## 1. Upfront AI disclosure

The first spoken turn tells the tenant they are speaking with an AI assistant for the property, calling about the balance. Disclosure happens before any plan, waiver, or payment link.

## 2. Landlord policy in code

The landlord sets limits on the dashboard. The agent reads them as data. Enforcement is ordinary code, run before Claude is allowed to offer or confirm terms.

| Setting | Rule |
| --- | --- |
| Maximum installments | A plan with more splits is rejected. The counter-offer uses the maximum. |
| Grace-period window | A promised date outside the window is rejected. The counter-offer uses the last allowed date. |
| Fee-waiver cap | A waiver above the cap is rejected. The counter-offer uses the cap. A cap of zero means no waiver. |

Claude may explain a counter-offer. It may not cross it. A tenant asking to pay nothing still hits the code path and gets the tightest plan the settings allow, or a handoff if a Jev check flags.

## 3. Jev decisions

Jev is a System One model. We use it as the low-latency decision model so the agent gets better judgment from constraints we can pre-define. The constraints are the questions, instructions, and true/false criteria below. They are written before the call, not invented mid-sentence by Claude.

Jev is called as `typesafe-ai/jev` through [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev). It returns a typed decision and a probability. It does not generate the spoken reply. One request evaluates every question against the same state, in parallel, which is what keeps it inside a phone-call turn.

The voice agent posts the latest transcript (and any Gemini photo summary) to `https://ai-gateway.vercel.sh/v1/evaluate` with `AI_GATEWAY_API_KEY`. Zero data retention is on.

```json
{
  "model": "typesafe-ai/jev",
  "state": {
    "transcript": "latest tenant and agent turns",
    "photo_summary": "optional Gemini description",
    "constraints": {
      "max_installments": 2,
      "grace_days": 14,
      "fee_waiver_cap": 0
    }
  },
  "questions": {
    "hardship": {
      "type": "boolean",
      "instructions": "Is the tenant describing hardship that should go to a human?",
      "criteria": {
        "true": "Job loss, illness, family emergency, or inability to pay that needs a person.",
        "false": "Ordinary scheduling, a question, or a normal payment plan."
      }
    },
    "dispute": {
      "type": "boolean",
      "instructions": "Is the tenant disputing the charge, the ledger, or that they owe this amount?",
      "criteria": {
        "true": "They say the balance is wrong, rent was paid, or a repair makes the charge unfair.",
        "false": "They accept the balance and are only discussing how to pay."
      }
    },
    "distressed": {
      "type": "boolean",
      "instructions": "Does the tenant sound distressed or overwhelmed enough that negotiation should stop?",
      "criteria": {
        "true": "Panic, crying, fear, or language that continuing the collection call would be inappropriate.",
        "false": "Calm, frustrated, or businesslike."
      }
    }
  },
  "providerOptions": {
    "gateway": { "zeroDataRetention": true }
  }
}
```

Each answer is `{ "type": "boolean", "probability": 0.0 }`. Probability is how likely the statement is true, from 0 to 1.

### Over-flag

Start the flag line at **0.35**. Any question at or above 0.35 blocks new concessions and routes the call to a human. The line is a constant in code so it can be lowered further after hearing real calls. Jev is not asked to be precise. Uncertain calls hand off.

| Probability | Code does |
| --- | --- |
| Below 0.35 on all three | Claude keeps negotiating inside policy. |
| 0.35 or higher on any question | Block plan changes and payment links. Mark the call for a person. Claude tells the tenant someone from the property will follow up. |

A flagged dispute still gets a calm acknowledgement of what the tenant raised. The agent does not argue the ledger.

### Claude fallback

If the Gateway key, model access, or latency is not ready in time, the same three questions go to Claude with a strict JSON schema. The 0.35 rule and the handoff behavior stay in code. Policy limits stay in code either way.

## 4. Photos with Gemini

A tenant can send a photo during the call, such as a hardship letter or a picture of a repair. Gemini returns a short factual description. That description is appended to the Jev `state` on the next check and stored on the call record.

- A hardship letter pushes the hardship check and, when flagged, the human handoff.
- A repair issue is logged for the landlord and pushes the dispute check when the tenant ties it to the balance.

Gemini does not set payment terms.

## Human handoff

Handoff is a call state, not a vibe.

- Reason: `hardship`, `dispute`, or `distressed` (one or more).
- The probabilities and the transcript window that triggered them are stored.
- Claude’s next turn is short, respectful, and ends negotiation.
- The dashboard shows the call as waiting for a person.
