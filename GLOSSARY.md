# ScamLord

The agent floor for ScamLord: where a person watches runs and asks the Agent manager what they are doing.

## Language

**Agent floor**:
The page where runs are watched. No landlord login.
_Avoid_: Dashboard (that word is the landlord app), Shipworthy

**Agent manager**:
The chat on the agent floor. It reads runs and answers in plain language. Phone agents are autonomous: it does not start them, stop them, or change a run already on a step.
_Avoid_: Floor agent, Agent, ScamLord

**Run**:
One piece of agent work with a status: in progress, waiting on payment, or waiting on a person. It names a tenant, a property, and the step it is on.
_Avoid_: Working agent, call (a call is what a run may be doing), agent

**Step**:
One node on a run: Stripe invoice, workflow start, disclosure, Jev check, policy, Stripe plan, payment link, paid, or handoff.
_Avoid_: Status (status is in progress, waiting on payment, or waiting on a person), state

**Trace**:
What you see when you open a run: the transcript, the perk, the plan, and each Jev check.
_Avoid_: Log
