# Landlord dashboard

Supporting note. The locked spec is [SPEC.md](SPEC.md).

A landlord logs in and sees their own portfolio. The app is a small Vercel site. Supabase Auth is the login. Row level security limits every query to that landlord.

The demo account is seeded. The AppFolio connection on screen is display only: it shows the details of a connected account and does not call AppFolio. Production uses the same login after a real PMS sync has created the landlord row.

## Login

Email and password. The session is the Supabase user on `landlords.auth user`. A signed-out visit lands on the login screen. There is no public portfolio view.

## After login

Five screens. That is the whole app.

**Connection.** AppFolio, shown as connected. The screen lists the account name, the connected status, when it last synced, and the counts it brought in: properties, units, and tenancies. A button reads “Sync now” and does not hit AppFolio. The rows under it are the seeded Supabase records, labeled as imported from AppFolio.

**Portfolio.** Those same properties, units, and tenancies. Each tenancy shows the open Stripe invoice: amount, due date, and status. This is the screen that proves the agent watches more than one property.

**Calls.** Calls for those tenancies. Status is one of in progress, waiting on a person, or paid. Opening a call shows the transcript, any perk offered, and the plan. A handoff sits here until someone takes it.

**Settings.** The limits the agent is allowed to offer: maximum installments, grace-period days, fee-waiver cap. Perks live here too, each with the condition that unlocks it. Saving writes `policies` and `perks`. The next call reads those rows.

**Billing.** Outcomes billed to this landlord: calls placed, plans accepted, payments cleared. The amounts come from Stripe. The rent collected is listed separately and is not part of this bill.

## What the landlord cannot do here

They do not edit the ledger. The balance is the Stripe invoice. They do not start the call by hand. An overdue invoice does that. They do not see another landlord’s rows. They do not see the agent floor.

## Agent floor

Same Vercel app, not one of the five landlord screens. No landlord login. This page is how we watch the agents that are working, and how we review a Jev decision after the call.

It lists each live run. A `ToolLoopAgent` is on a call. A `WorkflowAgent` is starting a call, waiting on a Stripe payment, or holding a handoff. Status is in progress, waiting on payment, or waiting on a person. The row names the tenant, the property, and the step that run is on.

The main view is a node graph, built with [React Flow](https://reactflow.dev/). Nodes are the steps of a call: the Stripe invoice, the workflow start, disclosure, the Jev check, policy, the Stripe plan, the payment link, and then either paid or handoff. Each working agent sits on the node for its current step.

Opening a run shows its trace. Every Jev check keeps the transcript window, any photo summary, the three questions with the criteria that were sent, each probability, and what code did with the 0.35 line. A continue is stored the same way as a flag. When a decision looks wrong, that record is what we read, then we change the criterion text or the line. The next call uses the new text. See [Safeguards](safeguards.md).
