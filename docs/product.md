# CineMatch product direction

Help someone choose something they will enjoy watching tonight, quickly, on a
service they can actually use. Recommendation quality and low effort matter more
than feature count or catalog size. This revised direction reflects Srikanth's
request to improve the plan rather than preserve the original checklist.

## First-session experience

No account or watch history required. Four compact steps, with back/edit support:

1. **Services:** select US streaming subscriptions or skip to all. Distinguish
   subscription access from rental/purchase options; do not imply everything is free.
2. **Optional taste:** choose 3–5 favorites and genres to avoid, or skip without
   penalty. These are quiz seed titles, not recommendations. Never force someone
   to pick unfamiliar titles just to continue.
3. **Tonight:** mood (laugh, cry, thrill, think, comfort), movie/series and length.
   Movies: under 100 minutes, any, epic. Series: short episodes, one season,
   long-running. Make the exact boundaries explicit in the filter implementation.
4. **Picks:** one clear best match and up to four alternatives, each with a grounded
   reason, poster, time commitment and current US service information. Fewer honest
   results are better than invented or incompatible results. Explain shortages and
   offer editable constraints rather than silently relaxing them.

Actions: Watch now where a verified link exists, Watched, Like, Not for me,
Show me more and Undo. Do not label a generic provider-information URL as direct
playback. Preferences remain editable; guest state lives in local storage.
Optional sign-in later syncs devices. Series recommendations are shows/seasons to
start, not individual episodes. No social features or in-app playback in v1.

## Recommendation strategy

Start with an inspectable deterministic baseline and measure improvements. Use
content retrieval and an optional hosted LLM reranker; do not assume an LLM makes
recommendations better simply because its explanations sound convincing.

- Embed overview, genres and keywords using versioned, dimension-validated vectors.
- Average seed embeddings when present. With no seeds, use a diversified eligible
  baseline conditioned on explicit mood/format/services; distinguish the lower
  confidence of cold-start picks without blocking the user.
- Apply hard constraints **before** limiting retrieval to a candidate pool, or use
  tested adaptive overfetch. Retrieving 50 and then filtering can unnecessarily
  eliminate almost the entire pool for people with narrow service selections.
- Rerank eligible candidates and balance relevance with diversity. Return only
  supplied IDs; validate output and ground every reason in metadata and answers.
  Invalid output, timeout or provider outage uses a deterministic safe fallback.
- Watched means exclude from future results, not liked. Explicit likes/dislikes
  provide stronger taste evidence; a skip can mean “not tonight.” Updates must be
  bounded, reversible and idempotent rather than causing runaway preference drift.
- Refresh availability nightly and retain source timestamps. Measure stale and
  broken availability; catalog scale alone does not establish trustworthy coverage.
- Enforce shared server-side session/IP budgets before every paid call, including
  retries and embeddings. Public access stays gated until those controls pass tests.

## Evidence of quality

Use at least 30 reviewed cases across cold start, mainstream and niche tastes,
service constraints, avoided genres, movies and series. Compare with the baseline
using a written rubric for relevance, diversity and explanation faithfulness;
report validity, availability freshness, p50/p95 latency and fallback rate.
Hard-filter violations and invented titles are failures, not acceptable tradeoffs.

Targets to validate: first useful recommendation within 60 seconds without an
account, normal recommendation response within 3 seconds, and users identifying
picks they actually want to watch. These are targets, not claims of current results.
During the twenty-user beta, collect consented feedback on choice confidence,
rejection reasons, streaming accuracy, abandonment and return-session improvement.
Use the findings to revise the ranking and flow before expanding features.

## Approved stack and boundaries

- Next.js App Router, TypeScript, Tailwind; responsive and eventually installable PWA.
- Next.js route handlers; no separate backend for v1.
- Postgres with pgvector (Neon or Supabase); existing scaffold uses Drizzle/postgres.
- TMDB catalog and provisional US watch-provider data; TMDB and JustWatch attribution.
- Hosted embedding/rerank provider behind small interfaces; no provider selected here.
- Vercel Cron for nightly refresh, Auth.js for optional accounts.
- GitHub Actions, Vitest, Playwright; Vercel PR previews.

Do not introduce dependencies outside this stack or paid services without owner
approval. Availability vendor/commercial terms and countries beyond US remain owner
decisions. Research current official terms before a commercial recommendation;
do not assume third-party availability grants playback deep links or commercial rights.
Vercel/account/billing actions remain with Srikanth. See AGENTS.md for work rules.
