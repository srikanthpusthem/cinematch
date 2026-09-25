# CineMatch

A web app (phone and laptop) that recommends a movie or series in under two minutes, for anyone, with no watch history required. See [`AGENTS.md`](./AGENTS.md) for the full product summary, stack, working agreements, and the protocol multiple AI agents follow when picking up issues from the GitHub Projects board.

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

`TMDB_API_KEY` and `LLM_API_KEY` aren't used yet in M0 — they're placeholders for M1/M2.

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

## Project tracking setup

`scripts/setup-github-project.sh` is a one-time, idempotent script that creates the repo's labels, milestones (M0-M5), the 36 planned issues, and a GitHub Projects board with every issue added — see `AGENTS.md` for how the board is used day to day. It needs the [`gh` CLI](https://cli.github.com/) authenticated with the `project` scope (not available to this AI agent, so it hasn't been run yet):

```bash
brew install gh
gh auth login
gh auth refresh -s project
OWNER=srikanthpusthem REPO=strip-down ./scripts/setup-github-project.sh   # or DRY_RUN=1 first
```
