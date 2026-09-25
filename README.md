# CineMatch

A web app (phone and laptop) that helps you choose a movie or series quickly, with no account or watch history required. See [product direction](docs/product.md) for the experience, recommendation quality goals and approved stack.

Contributors and agents: read [AGENTS.md](AGENTS.md) first, then [project operations](docs/project.md). Track and claim work on the [CineMatch board](https://github.com/users/srikanthpusthem/projects/3). Claude and Grok have dedicated entrypoints; all agents follow the same rules. Astra manages priorities and reviews; Claude, Grok and Codex workers pick up eligible Ready tickets.

This is the **M0 (Foundation)** scaffold: an empty app with CI, tooling, and DB migrations wired up. No catalog data or recommendation logic yet — that's M1 and beyond.

## Prerequisites

- Node.js 22+
- Docker (for a local Postgres + pgvector instance)

## Setup

```bash
npm install
cp .env.example .env.local
```

Start local Postgres (with the pgvector extension) via Docker:

```bash
docker compose up -d
```

Fill in `DATABASE_URL` in `.env.local` (the docker-compose default is shown as a comment in `.env.example`). Then run the first migration, which enables the `pgvector` extension:

```bash
npm run db:migrate
```

`TMDB_API_KEY` is read by the server-only TMDB client in `src/tmdb/` (v3 API key or v4 read access token). It isn't needed for `npm run test`, which uses fixtures. `LLM_API_KEY` is a placeholder for M2.

## Running the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tests

Unit tests (Vitest):

```bash
npm run test
```

End-to-end smoke test (Playwright — builds the app and checks the home page loads):

```bash
npm run test:e2e
```

## Other checks

```bash
npm run lint        # ESLint
npm run format      # Prettier check (npm run format:write to fix)
npm run typecheck   # tsc --noEmit
```

All of the above run in CI on every pull request (see `.github/workflows/ci.yml`).

## Database migrations

Migrations live in `drizzle/` and are managed with [drizzle-kit](https://orm.drizzle.team/kit-docs/overview):

```bash
npm run db:generate   # generate a migration from schema changes in src/db/schema.ts
npm run db:migrate     # apply pending migrations
```
