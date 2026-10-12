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

All of the above, plus the database migration check below, run in CI on every pull request (see `.github/workflows/ci.yml`).

## Database migrations

Migrations live in `drizzle/` and are managed with [drizzle-kit](https://orm.drizzle.team/kit-docs/overview). The catalog model, constraints and indexes are documented in [docs/catalog-schema.md](docs/catalog-schema.md).

Commands:

```bash
npm run db:generate   # generate a migration from schema changes in src/db/schema.ts
npm run db:migrate    # apply pending migrations
npm run test:db       # apply migrations twice and verify pgvector + the migration journal
```

drizzle-kit reads `DATABASE_URL` from `.env.local` (see `src/db/database-url.ts`). A non-empty `DATABASE_URL` set in the shell environment takes precedence, e.g. `DATABASE_URL=postgresql://... npm run db:migrate` to target another database. If neither is set, the command fails with a message pointing at `.env.example`. Quote the value if it contains `#` (for example in a password), since an unquoted `#` starts a comment; the loader rejects that case rather than silently truncating the URL.

`npm run test:db` needs a running pgvector Postgres (`docker compose up -d`) and is not part of `npm run test`. CI runs it against a fresh `pgvector/pgvector:pg16` service on every pull request (the `db` job in `.github/workflows/ci.yml`).

## Catalog ingestion

`npm run catalog:ingest` fills the catalog from TMDB. It needs `DATABASE_URL` (migrated) and `TMDB_API_KEY`, from the environment or `.env.local`.

```bash
npm run catalog:ingest                          # defaults: 20000 movies, 5000 series
npm run catalog:ingest -- --movies 200 --series 50   # small trial run
```

Flags: `--movies`, `--series`, `--max-age-days` (default 7), `--concurrency` (default 8), `--from-year` (default 1950) and `--to-year`. The job is safe to re-run: titles fetched within `--max-age-days` are skipped, so an interrupted run resumes where it stopped. It prints a summary and a JSON report (counts, failures, freshness), never keys or connection strings. It exits non-zero if it aborts: on an invalid API key, or when more than 5% of detail requests fail. Expect roughly 25 minutes for a full run at the client's default of 20 requests per second.
