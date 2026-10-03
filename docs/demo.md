# Demo

Stripe is the deepest category bet. Everything else on stage supports that one live payment.

## Live path

The judge plays the tenant. A second screen shows the Vercel dashboard.

1. The landlord settings screen is already filled: a small installment cap, a short grace window, a fee-waiver cap of zero or a token amount. This is the UX beat.
2. The call connects. The agent discloses that it is an AI and states a late balance.
3. The judge asks for something outside policy (more installments, a waived fee, or a far-off date).
4. The agent comes back with the plan the code allows, in a short respectful turn. That is the Claude beat, inside guardrails.
5. The judge agrees.
6. The agent texts a Stripe Checkout link while the call is still up.
7. The judge pays.
8. The agent confirms the payment out loud, and the dashboard moves the call to paid.

Optional branch, only if time allows: the judge mentions a hardship or holds up a letter. Gemini reads the photo, Jev decides it matches a pre-defined hardship constraint, and the agent stops and hands off. Do not let this branch replace the payment.

## Recorded backup

Record the same eight steps before the demo, including the SMS, the Stripe success screen, and the spoken confirmation. If the live call, SMS, or webhook fails, play the recording and keep the dashboard visible.

## What each category needs in the room

| Category | Visible evidence |
| --- | --- |
| Stripe | Link on the judge’s phone, payment, spoken confirmation. |
| Claude | Negotiation that changes when the judge asks for terms the settings forbid. |
| Gemini | One photo read into the call, if the optional branch is used. |
| Vercel | Dashboard live on a deployed URL. The call runs through the Vercel agent. Jev calls show in AI Gateway usage if a judge asks. |
| UX | The settings screen, used, not a slide. |
| Codex | Build history from the session, ready to show if asked. Codex is not a runtime feature. |

## Failure on stage

If Jev is not live, the Claude fallback still runs the three checks and the Stripe path still works. Say that plainly if asked. Do not skip disclosure, the policy counter-offer, or the live payment to save time.
