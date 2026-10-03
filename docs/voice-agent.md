# Voice agent

The voice agent is a LiveKit pipeline. Deepgram transcribes, Claude negotiates and calls tools, ElevenLabs speaks, Silero handles voice activity. Jev is the low-latency decision model beside that loop: each turn is judged against constraints defined before the call. Numeric policy still runs in code.

## Persona

ScamLord AI sounds calm, brief, and respectful. It is collecting rent for a property, not winning an argument. The first turn discloses that it is an AI.

## What Claude may do

- Ask what date and amount the tenant can pay.
- Offer a plan that policy code has already accepted.
- Explain a counter-offer that policy code returned.
- Send a Stripe link only after the tenant accepts an in-policy plan and no Jev flag is set.
- Confirm a payment only after Stripe reports it.
- Hand the call to a person when a check flags.

## System prompt

```python
system_prompt = (
    "You are ScamLord AI, a calm property assistant calling a tenant about their balance. "
    "Your first sentence tells them you are an AI assistant for the property. "
    "\n"
    "AUTHORITY: "
    "1. You cannot waive fees, extend dates, or split payments beyond the policy tool. "
    "2. Before you offer or confirm any plan, call check_policy with the dates, amounts, and waiver you intend to say. "
    "3. Say only the terms check_policy returns. "
    "4. After each tenant turn, call check_signals. "
    "5. If check_signals says handoff, stop negotiating. Tell them a person from the property will follow up. "
    "6. Call send_payment_link only after they accept terms check_policy allowed and check_signals says continue. "
    "7. Confirm a payment only when confirm_payment says it succeeded. "
    "\n"
    "SPEECH: "
    "- One or two spoken sentences per turn. "
    "- No JSON, IDs, probabilities, or tool names."
)
```

## Tools

### `check_policy`

Input: proposed installments, first payment date, amount, and fee waiver.

The tool runs the landlord settings in code and returns a short string Claude can say: the accepted terms, or the counter-offer at the boundary of those settings.

### `check_signals`

Input: none. The tool reads the current transcript, any photo summary, and the pre-defined constraints, calls Jev (or Claude if the fallback is on), and applies the 0.35 rule from [Safeguards](safeguards.md).

Returns either `continue` or `handoff` plus the reason (`hardship`, `dispute`, `distressed`). Claude speaks the handoff. It does not mention the model or the score.

### `send_payment_link`

Input: `tenant_id`, `amount`.

Sends an SMS with a Stripe Checkout link for that amount. Refuses when policy has not accepted the plan, when a handoff is active, or when the amount does not match the accepted plan.

### `confirm_payment`

Input: `tenant_id`.

Reads the Stripe result for this call. Returns the paid amount when the webhook has landed, or that payment is still pending.

## Pipeline sketch

```python
agent = VoicePipelineAgent(
    vad=silero.VAD.load(),
    stt=deepgram.STT(),
    llm=anthropic.LLM(),
    tts=elevenlabs.TTS(),
    fnc_ctx=CallTools(policy=landlord_policy, gateway=ai_gateway),
    chat_ctx=llm.ChatContext().append(role="system", text=system_prompt),
)
```

Constructor details follow the LiveKit Agents version pinned at build time. The behavior that must survive that pin: disclosure first, policy before any offer, Jev before continuing, Stripe only for an accepted plan, confirmation only from Stripe.
