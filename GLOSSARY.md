# RentRecovery

The agent floor for RentRecovery: where a person watches agents and asks the Agent manager what they are doing.

## Language

**Agent floor**:
The page where agents are watched. The panel opposite the sidebar chat shows their graphs.
_Avoid_: Dashboard (that word is the landlord app), Shipworthy, Chat artifact, grid

**Home**:
The landlord tab that shows money recovered, what still needs a person, and recent agent activity. It sits beside the Agent manager chat; Live calls is the Agent floor tab on the same route.
_Avoid_: Overview, Portfolio (Portfolio is the multi-property SPEC screen, not this tab)

**Agent manager**:
The sidebar chat opposite the graph. It reads agents and answers in plain language. The agents on the graph are autonomous: it does not start them, stop them, or change an agent already on a step.
_Avoid_: Floor agent

**Agent**:
One chain of linked steps. It has a status: in progress, waiting on payment, or waiting on a person. It names a tenant, a property, and the step it is on.
_Avoid_: Run, call, working agent

**Tenant**:
The person named on an agent who owes rent for a property.
_Avoid_: Client, renter, customer

**Agent view**:
The view opened from an agent. It shows that agent's chain, trace, invoice, schedule, outcome charges, and the policy and perks that bound it.
_Avoid_: Settings screen, Calls screen, Billing screen

**Policy**:
The limits an agent may offer: maximum installments, grace window, and fee-waiver cap. One policy for the landlord, shared by that landlord's agents.
_Avoid_: Settings, per-agent settings

**Perk**:
A landlord-written favor an agent may offer when its condition matches the plan.
_Avoid_: Discount, waiver

**Step**:
One node in an agent's chain: Stripe invoice, workflow start, disclosure, Jev check, policy, Stripe plan, payment link, paid, or handoff.
_Avoid_: Status (status is in progress, waiting on payment, or waiting on a person), state

**Trace**:
What you see when you open an agent: the transcript, the perk, the plan, and each Jev check.
_Avoid_: Log
