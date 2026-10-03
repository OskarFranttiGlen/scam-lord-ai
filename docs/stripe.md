# Stripe

Stripe is the backbone, not the checkout step at the end. It tells the agent who to call, the agent fixes the balance inside Stripe, and Stripe pays the landlord.

The pitch line: Stripe tells the agent who to call, the agent fixes it inside Stripe, and Stripe pays the landlord.

This matters most for a landlord or property manager with many properties. One overdue invoice, on any unit, starts the agent. Nobody has to notice which property slipped.

## 1. Stripe events start the call

Collection is a closed loop. A person does not press “call.”

| Stripe event | What the agent does |
| --- | --- |
| `invoice.payment_failed`, or an invoice past due | `WorkflowAgent` starts a call for that tenancy, with the invoice amount, the property, and the unit. |
| A later installment on the plan fails | The agent calls again with that context. It can say the second payment did not go through and offer to move it, inside the grace window. |

The same lifecycle runs on every property in the portfolio. Supabase maps the Stripe customer to the tenancy so the call knows the name, the phone, the email, and the landlord’s perks.

## 2. The agent operates Stripe during the call

Claude uses the Stripe Agent Toolkit, or the Stripe MCP server, as tools. Judges should see the agent working in Stripe, not only texting a link.

During the call it can:

- Read the live invoice and balance
- Create or update the invoice
- Put the agreed installments on a Subscription Schedule, with dates the tenant can keep
- Issue a credit note for a late fee only when policy code allows that amount
- Hand back the hosted invoice or Checkout link

Twilio texts that link. Resend emails it. One Stripe object, two channels.

Policy code still bounds the schedule and the credit note. The toolkit does not get to waive more than the landlord’s cap or add installments past the maximum.

## 3. Plans people can finish

When there is time past the hackathon core:

- Line installment dates up with the tenant’s payday
- Offer ACH debit
- Leave Smart Retries on for a failed installment
- With consent, use Financial Connections to suggest a plan the balance can support

## 4. How we get paid, and how the landlord gets paid

Two different Stripe flows.

**We charge the landlord for usage.** Each property manager we onboard brings one or more landlords. Each landlord is a Stripe customer with a payment method on file. Pricing is pay-per-use through the [Machine Payments Protocol](https://docs.stripe.com/payments/machine): every agent action on that landlord’s portfolio is a priced request, and Stripe settles it. There is no flat subscription. A landlord with more properties, more overdue invoices, and more calls pays more, because that is the usage.

An agent action is a tool or inference on their behalf: starting the call, a Jev check, a Stripe write, sending the link. The call row records which landlord the meter event belongs to.

**The tenant’s rent still goes to the landlord.** Each landlord is also a connected account (Accounts v2). Recovered rent settles there. Our usage charge is separate from that payout. We do not take the rent.

Build Connect in the hackathon if the closed loop and the in-call Stripe tools are already solid. The usage meter should be live for the demo call, so a judge can see the landlord get charged for the agent run.

## 5. Recovery dashboard

The Vercel dashboard reads Stripe, not a second ledger:

- Dollars recovered
- Plan completion rate
- Average days to pay

## Hackathon cut

Build 1 and 2 properly. Add 4 if time allows. 3 and 5 can be thin or left as the next pass. The demo still ends with the judge paying and the agent confirming it live.

## What Supabase still owns

Stripe holds invoices, schedules, credit notes, and payouts. Supabase holds what Stripe does not: properties, units, tenancy contact details, landlord policy, perks, call transcripts, and Jev scores. Each tenancy stores the tenant’s Stripe customer id. Each landlord stores two Stripe ids: the customer we bill for usage, and the connected account that receives rent.
