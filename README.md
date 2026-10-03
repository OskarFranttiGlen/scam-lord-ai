# Shipworthy

Hackathon template: hero chat dispatches into a builder with a chat panel and a structured **Chat artifact** (week/day grid for now). Brand and agent chrome are domain-neutral (**Shipworthy** / **Agent**).

Gut of a former Proxima clone. History: [ADR 0033](docs/adr/complete/0033-shipworthy-hackathon-template/index.md). Shipped keep-set for this tree: [ADR 0034](docs/adr/complete/0034-fitness-strip-artifact-crud/index.md). Copy to `hackathon_template` when you want a clean remote.

## What you get

- `/` hero Prompt only (no marketing below the fold)
- `/dashboard` dual-pane: Agent chat + Chat artifact grid
- Durable `artifacts` table (JSON document). Hollow or empty grid on New arrival until the Agent mutates via `readArtifact` / `mutateArtifact`
- Skill sandbox tools (`loadSkill`, `readFile`, `bash`) plus optional `getMoreInfoQuestions`
- Auth pages and Free metering

Fitness builder residue, Soft-fail, Agentic memory, and Hevy export/sync chrome are out of the template happy path. Fitness and `hevy_*` tables are not in the repo migrations.

Glossary: [`CONTEXT.md`](CONTEXT.md).

## Setup

Requires Node 20+, Docker Desktop (for local Supabase), and a shell that can run bash.

```bash
cp .env.template .env.local
# Fill Supabase + OPENAI_API_KEY at minimum (see below)

./start-local-supabase.sh
npm install
npm run dev
```

`./start-local-supabase.sh` starts Docker Supabase, applies migrations, creates the test user, points `.env.local` at `http://127.0.0.1:54321`, and regenerates `src/hooks/supabase.ts`.

Stop local Supabase with `npx supabase stop`. Status/keys: `npx supabase status`.

### Test login

After `./start-local-supabase.sh`:

- Email: `test@localhost.dev`
- Password: `Password123!`

### Env vars

See [`.env.template`](.env.template).

| Area | Required? | Notes |
|------|-----------|--------|
| Supabase anon URL/key | Yes for app data | `NEXT_PUBLIC_REACT_APP_SUPABASE_*` |
| `OPENAI_API_KEY` | Yes for `/api/chat` | Anon + authenticated chat |
| `SUPABASE_SECRET_KEY` | Server paths | Service role; never expose to the client |
| Stripe Sync Engine | Bring your own project | Set `NEXT_PUBLIC_REACT_APP_SUPABASE_*` to a Supabase project that already has Stripe Sync Engine. The hosted demo does not accept a Stripe secret. |
| Payload / blog Supabase | Unused | Blog/admin routes stripped |
| Hevy share keys | Unused | Export/sync chrome stripped |
| PostHog | Optional | Analytics |

## Scripts

```bash
npm run dev          # Next.js
npm run lint
npm run test:ci      # vitest run
npm run build
```

## Contracts

ADR 0034 contracts C1–C16 are the acceptance bar (includes residual 0033 checks). Sub-plan [08](docs/adr/complete/0034-fitness-strip-artifact-crud/08-verify.md) lists the verify greps.
