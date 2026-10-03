## Agent skills

### Domain docs

Product spec: [docs/SPEC.md](docs/SPEC.md). Glossary: [GLOSSARY.md](GLOSSARY.md) and [CONTEXT.md](CONTEXT.md). ADRs: [docs/adr/](docs/adr/).

### Database (Supabase)

In `public` schema migrations, foreign keys to a user must reference **`public.users (id)`**, not `auth.users`. See existing FKs in `supabase/migrations/00000000000000_baseline.sql`.
