# CineMatch

A web app (phone and laptop) that recommends a movie or series in under two minutes, for anyone, with no watch history required. It works across all streaming services and shows where each pick streams.

## Product summary

Four-screen first session, only the last shows titles:

1.  Services: pick the streaming services you have (skippable, defaults to all).
2.  Taste quiz: pick 3 to 5 favorite titles from a visual grid, then genres to avoid.
3.  Mood: one tap for tonight's mood (laugh, cry, thrill, think, comfort), a movie or series toggle, and length (movies: under 100 min, any, epic; series: short episodes, one season, long-running).
4.  Results: five picks, each with a one-line reason, poster, runtime and the services it streams on. Actions: Watch now (deep link), Watched, Not for me, Show me more.

Accounts are optional. A guest session lives in local storage; signing in syncs across devices.

Non-goals for v1: social features, in-app playback. Streaming availability is US only for v1.

## Stack

- Next.js (App Router), TypeScript, Tailwind. Responsive first, installable as a PWA.
- API: Next.js route handlers. No separate backend in v1.
- Database: Postgres with pgvector (Neon or Supabase).
- Catalog data: TMDB API for movies, series, seasons, episodes and watch providers. JustWatch attribution is required for provider data. Show TMDB attribution in the footer.
- Embeddings and re-rank: hosted LLM API, provider behind a small interface so it can be swapped.
- Jobs: Vercel Cron for nightly catalog and availability refresh.
- Auth: Auth.js, optional sign-in.
- Quality: GitHub Actions, Vitest, Playwright.
- Deploy: Vercel, with preview deploys on every PR.

## Recommendation approach

Content-based retrieval plus an LLM re-ranker (no collaborative filtering until there is interaction data).

1.  Embed each title's overview, genres and keywords with pgvector.
2.  Taste vector = average of the embeddings of the user's quiz picks.
3.  Retrieve the nearest 50 candidates, then apply hard filters: user's services, avoided genres, movie or series toggle, length, already watched.
4.  LLM re-ranks the 50 candidates given the mood and returns the top 5 with a one-line reason each. It may only choose from the given candidates, never invent titles.
5.  Watched, Liked and Not for me events move the taste vector toward or away from those titles.

Series are recommended at title and season level ("a show to start"), not episode level.

## Milestones

- M0 Foundation: repo, CI, preview deploys green, empty app live on a URL.
- M1 Catalog: 20k+ movies and 5k+ series with metadata and US streaming availability in the database.
- M2 Recommender: given 3 titles and a mood, returns 5 sensible picks in under 3 seconds. Includes an offline eval set of 30 hand-checked cases.
- M3 Product UI: full four-screen flow on phone and laptop.
- M4 Accounts and polish: signed-in sync, PWA install, accessibility pass.
- M5 Beta: 20 real users, feedback, error monitoring, rate limits and LLM cost caps.

## Working agreements

- Work is tracked on the GitHub Projects board. Every change maps to an issue and ships through a pull request. Do not push to main.
- One issue per PR, small PRs. PR description says what changed, how it was tested, and links the issue.
- Definition of done: merged via PR, CI green, tests added for new logic, and checked at a phone-sized viewport if it touches UI.
- Verify before claiming done: run lint, typecheck and tests, and say what you actually ran. If something was not run, say so.
- No secrets in the repo. Keys go in .env.local (gitignored) and Vercel env vars; keep .env.example current.
- Cap LLM calls per session and per IP before any public link goes out.
- Ask before adding a new paid service or a dependency that is not in the stack above.

## Open decisions

- TMDB commercial licensing and the streaming-availability provider (TMDB watch providers, Watchmode, or Streaming Availability API). Decide before M5.
- Whether to support countries beyond the US.
