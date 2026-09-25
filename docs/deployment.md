# Deployment checklist (owner-only, M0 gate)

This checklist documents how to deploy CineMatch while keeping public access gated until shared server-side per-session and per-IP LLM quotas are implemented and verified.

## Scope and current state

- M0 scaffold currently has no application API route for paid inference.
  - Verify in repo with:
    - `find src/app -maxdepth 3 -type f`
    - `rg -n "openai|anthropic|gemini|llm|embedding|rerank|inference|LLM_API_KEY" src`
- `TMDB_API_KEY` and `LLM_API_KEY` are placeholders only in M0 (`README.md`, `.env.example`), not active runtime calls.
- **Important:** no current paid route is not proof that quota enforcement exists. Keep deployment protected until quotas are delivered and tested.

## Owner setup: import repository in Vercel

1. In Vercel, create/import project from GitHub repository `srikanthpusthem/cinematch`.
2. Confirm production branch is `main`.
3. Keep framework/build settings at the Next.js defaults unless a reviewed issue changes them.
4. Add environment variables in Vercel project settings (never commit secret values):
   - Required now: `DATABASE_URL`
   - Reserved for future milestones: `TMDB_API_KEY`, `LLM_API_KEY`
5. Ensure local secret files stay ignored (`.env.local` is already gitignored).

## Database and credential gate

1. Use approved Postgres provider from project direction (Neon or Supabase with pgvector support).
2. Set `DATABASE_URL` in Vercel for Production, Preview, and Development scopes as needed.
3. Do not place credentials in code, docs with values, issue comments, or PR comments.
4. Rotate credentials immediately if exposure is suspected.

## Required protection before sharing links

1. Enable and verify Vercel deployment protection for:
   - Production deployment (`main`)
   - Preview deployments (PR branches)
2. Verify protection works from an unauthenticated/incognito browser session.
3. Record deployment URLs privately for owner/lead review; do not publish broadly.
4. Keep protection enabled until the quota gate below is completed.

## Public-release gate (must remain closed in M0)

Do **not** publish any public link until all items below are complete:

- [ ] Shared **server-side** per-session LLM budget enforcement exists.
- [ ] Shared **server-side** per-IP LLM budget enforcement exists.
- [ ] Enforcement is applied before every paid LLM call (including retries/embeddings if added).
- [ ] Automated and/or reproducible tests verify session and IP caps.
- [ ] Lead review confirms evidence; owner approves public release.

Until then, deployment must stay protected/private.

## Rollback / disable procedure

If any gate fails or behavior is uncertain:

1. Re-enable or tighten deployment protection immediately.
2. Remove public references to deployment URLs.
3. Roll back to the last known good Vercel deployment.
4. Disable or remove new environment variables tied to unverified paid integrations.
5. Open/link a follow-up issue with failure evidence and remediation plan before retrying public exposure.

## Owner handoff checklist for issue #12

Use this file as the deployment runbook for #12. Keep #12 blocked until the owner has:

- completed the Vercel import/configuration,
- verified protection on production and preview,
- validated that no public access is available,
- and confirmed quota enforcement tests in a later issue/PR.
