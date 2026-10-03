# Voice agent

The voice path is a LiveKit pipeline. Deepgram transcribes, ElevenLabs speaks, Silero handles voice activity. Each turn goes to a Vercel `ToolLoopAgent` running Claude. That agent loads the tenancy from Supabase and calls the tools below. Jev is the low-latency decision model beside that loop: each turn is judged against constraints defined before the call. Numeric policy still runs in code. A `WorkflowAgent` confirms payment and holds a handoff. See [Property system](pms.md).

## Persona

ScamLord AI sounds calm, brief, and respectful. It is collecting rent for a property, not winning an argument. The first turn discloses that it is an AI.

## What Claude may do

- Ask what date and amount the tenant can pay, and shape that into a plan: installment count, dates, amounts, and any waiver.
- Offer a plan that policy code has already accepted, including one landlord perk when it fits. A perk sounds human (“pay today and we’ll mow the lawn this weekend”) and is copied from the landlord’s list.
- Explain a counter-offer that policy code returned.
- Send the Stripe link by text and by email only after the tenant accepts an in-policy plan and no Jev flag is set.
- Confirm a payment only after Stripe reports it.
- Hand the call to a person when a check flags.

## System prompt

```python
system_prompt = (
    "You are ScamLord AI, a calm property assistant calling a tenant about their balance. "
    "Your first sentence tells them you are an AI assistant for the property. "
    "\n"
    "AUTHORITY: "
    "1. You cannot waive fees, extend dates, split payments, or promise favors beyond the policy tool. "
    "2. Negotiate a payment plan: installments, dates, amounts, and at most one perk from the landlord list. "
    "3. Before you offer or confirm any plan, call check_policy with that plan. "
    "4. Say only the terms check_policy returns. Phrase a perk in a warm, plain sentence. "
    "5. After each tenant turn, call check_signals. "
    "6. If check_signals says handoff, stop negotiating. Tell them a person from the property will follow up. "
    "7. Call send_payment_link only after they accept terms check_policy allowed and check_signals says continue. "
    "8. Confirm a payment only when confirm_payment says it succeeded. "
    "\n"
    "SPEECH: "
    "- One or two spoken sentences per turn. "
    "- No JSON, IDs, probabilities, or tool names."
)
```

## Tools

### `check_policy`

Input: proposed installments, each date and amount, any fee waiver, and an optional `perk_id`.

The tool runs the landlord settings in code. A perk is kept only if it belongs to this landlord and its condition matches the plan (for example, pay the open balance today). The tool returns a short string Claude can say: the accepted plan, or the counter-offer at the boundary of those settings.

### `check_signals`

Input: none. The tool reads the current transcript, any photo summary, and the pre-defined constraints, calls Jev (or Claude if the fallback is on), and applies the 0.35 rule from [Safeguards](safeguards.md).

Returns either `continue` or `handoff` plus the reason (`hardship`, `dispute`, `distressed`). Claude speaks the handoff. It does not mention the model or the score.

### `send_payment_link`

Input: `tenant_id`, `amount`.

Sends the Stripe-hosted link for the invoice or the new schedule. Sends the same link twice:

- Twilio SMS to the tenancy phone
- Resend email to the tenancy email

If one address is missing, it sends the channel that exists and says so. The call row stores the Twilio and Resend ids. The tool refuses when policy has not accepted the plan, when a handoff is active, or when the amount does not match the Stripe invoice.

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
