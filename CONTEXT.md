# Shipworthy

Hackathon template: hero chat input dispatches into a builder with a chat panel and a structured **Chat artifact**. Domain-neutral agent loop. The demo artifact stays a week/day grid for now; a later pass may swap the shape.

## Language

### Product


**Shipworthy**


The template product name shown on the hero and in UI chrome. Not Proxima.


_Avoid_: Proxima, Proxima Fitness, Andy (as product name)




### Agent


The chat-side LLM loop in the builder. Display name and system-prompt identity are generic (**Agent**), not a fitness coach persona.


_Avoid_: Andy, Integrated training coach, personal trainer




### Chat artifact


The structured object opposite the chat on **/dashboard**. For now it is a week/day grid of **Artifact day** columns; each day holds ordered **Artifact items** (title + optional notes)—not exercises or sets. The agent edits it through **Artifact CRUD tools**. A later pass may swap the grid shape.


_Avoid_: Program prescription (Proxima term), workout program (as the template's product), treating chat transcript as the artifact




### Artifact day


One day column in the **Chat artifact** grid (Day card UI). Layout fossil from the former Hevy day card; not a claim that the product is training days.


_Avoid_: HevyDayCard, routine card (ambiguous), treating day as a logged workout




### Artifact item


A titled line on an **Artifact day** (`id`, `title`, optional `notes`). The only in-card content in the template demo.


_Avoid_: Exercise, set, lift, Hevy template row




### New arrival


Entering **/dashboard** to create an artifact from the home prompt, typically with a `search=` dispatch (attachments optional). Homepage primary conversion. Chat bootstraps as today: the **Agent** starts a session and creates or edits the **Chat artifact** via **Artifact CRUD tools** only when that is appropriate. The default template has no product domain that forces an artifact or the **Questionnaire gate** to open.


_Avoid_: Build program (route-shaped), home prompt (implementation-shaped), client-seeding an empty durable artifact before the agent acts




### Arrival


How the user landed on **/dashboard** (URL params + navigation source). Determines artifact hydration and chat session bootstrap.


_Avoid_: Entry point (ambiguous), route, landing, treating /dashboard as an analytics overview




### Soft-fail


Out of scope. Fitness Soft-fail / program-sanity bags and stalemate cards are removed with the workout strip. Artifact mutates report ordinary tool errors.


_Avoid_: Porting Soft-fail labels onto neutral artifacts, Program stalemate




### Dispatch


An event that calls the LLM send path. May happen zero or more times after an arrival.


_Avoid_: Entry point (ambiguous), trigger (too generic)




### Artifact CRUD tools


Agent tools that create, read, or mutate the **Chat artifact**: **`readArtifact`**, **`mutateArtifact`** (typed op batches for the artifact shape), plus the skill sandbox (`loadSkill`, `readFile`, `bash`). Not domain-advice, history, export, or catalog tools.


_Avoid_: Workout tools, coaching tools, `mutateProgram` / `readProgram` (fitness fossils), treating `getMoreInfoQuestions` as CRUD




### Questionnaire gate


Optional builder UI opened by `getMoreInfoQuestions` to clarify a request before further work. The app owns a tiny **domain-neutral** question catalog (title / audience-style stubs), not fitness or training-profile questions. The agent is not instructed to force the gate open. Answers may ride on the next chat body; there is no durable profile persistence from the gate.


_Avoid_: Forced pre-build survey, onboarding, Training profile questions, Constraint profile questions, treating the gate as required before mutate




### Agentic memory


Out of scope for this template's default agent. Constraint profile, training profile, and body measurement inject/tools are stripped from instructions and tool keep-set.


_Avoid_: Treating questionnaire body fields as durable Agentic memory in the template




### Week Export


Out of scope. Hevy folder/routine export and `program_hevy_week_links` are product peripherals removed from the template.


_Avoid_: Sync-as-save, folder-title matching
