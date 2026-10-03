# CLAUDE.md

RentRecovery — see [README.md](README.md) and locked spec [docs/SPEC.md](docs/SPEC.md).

## Commands

```bash
npm run dev          # Next.js dev server
npm run build        # production build (pre-commit)
npm run lint         # eslint
npm run test:ci      # vitest run (pre-commit gate)
npx vitest run path/to/file.test.ts
```

Pre-commit (husky): `lint-staged` → `npm run test:ci` → `npm run build`.

Local Supabase: `./start-local-supabase.sh` (see README). Generated types: `src/hooks/supabase.ts` — edit migrations, not that file.

## App routes

- **`/`** — landing page with login.
- **`/dashboard`** — builder (chat + agent floor).
- **`/auth/*`** — Supabase auth.
- **`POST /api/chat`** — ToolLoopAgent (see `src/app/api/chat/`).

## Conventions

- Ambient globals in `@types/global.d.ts` (`TArtifactDay`, etc.).
- eslint: `I` interfaces, `T` types, 4-space indent, trailing commas.
- Supabase FKs to users → `public.users (id)`, not `auth.users`.
