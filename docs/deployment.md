# Deployment runbook (owner-only, M0 gate)

How to deploy CineMatch to Vercel while keeping **every URL private** until shared
server-side per-session and per-IP LLM quotas exist and are verified. Account,
billing and dashboard actions are owner-only (see AGENTS.md). Agents do not click
through these steps; they review the evidence the owner records in #12.

Vercel behavior below was checked against the official docs on 2026-09-28:
[Deployment Protection](https://vercel.com/docs/deployment-protection),
[Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
and [Instant Rollback](https://vercel.com/docs/instant-rollback). Re-check them if
the dashboard differs from what is described here.

## Current exposure (M0)

- There is no application API route, server action or LLM call. `src/app` holds
  only `layout.tsx`, `page.tsx`, `globals.css` and `favicon.ico`. The guest flow
  runs on in-memory mock data.
- `src/tmdb/` (the TMDB client) and `src/server/recommender/` (pure ranking logic)
  are not wired to any route. TMDB is a free metadata API, not paid inference.
- `LLM_API_KEY` is unused. Do **not** set it in Vercel until a reviewed issue needs it.
- **No paid route today is not proof that quotas exist.** The gate below stays
  closed until quota enforcement ships and is tested.

Re-verify before each deployment:

```bash
git ls-files src/app
git grep -n -i -E "route\.ts|\"use server\"|LLM_API_KEY|anthropic|openai|gemini" -- src
```

Any new `route.ts`, server action or `LLM_API_KEY` usage means the quota gate must
be re-assessed before the deployment is shared with anyone.

## 1. Set protection first (before importing)

Vercel's recommended default scope, **Standard Protection, does _not_ protect
production domains**. Only the **All Deployments** scope covers production, previews
and generated `*.vercel.app` URLs. Combined with **Vercel Authentication**, it needs
no paid add-on on any plan, including Hobby.

1. **Team default (so the very first deployment is never public):** Vercel dashboard
   → team **Settings** → **Deployment Protection**. Set the default for new projects
   to **All Deployments** with **Vercel Authentication**. If your plan or account type
   does not offer a team default, do step 3 immediately after import and treat the
   first production deployment as exposed until it's protected (see Rollback).
2. Do **not** enable Password Protection. It is not available on Hobby and costs
   $20 per protected project per month on Pro. Paid services are an owner decision.
3. **Per project (after import, and verify even if the default was set):** project
   → **Settings** → **Deployment Protection** → **Vercel Authentication**: toggle on,
   scope **All Deployments**, **Save**.
4. Do **not** create Shareable Links or "Protection Bypass for Automation" secrets.
   Both bypass Vercel Authentication. If CI ever needs one, open an issue first.

## 2. Import the repository

1. Go to <https://vercel.com/new> → **Import Git Repository** → authorize GitHub if
   prompted → select `srikanthpusthem/cinematch` → **Import**.
2. Framework preset: **Next.js**. Leave Root Directory, Build and Output settings at
   their defaults unless a reviewed issue changes them.
3. **Environment Variables:** add nothing yet. `DATABASE_URL` is added in step 3.
   Leave `TMDB_API_KEY` and `LLM_API_KEY` unset until a reviewed issue requires them.
4. **Deploy.** Then open project → **Settings** → **Git** and confirm
   **Production Branch** is `main`. Pull requests get Preview deployments by default.
5. Complete step 1.3 now if it wasn't already enforced.

## 3. Database (Postgres with pgvector)

The approved providers are Neon or Supabase (docs/product.md). Creating a database
may involve a plan choice; that is an owner decision.

1. Create a Postgres database with the provider. Copy its **direct** (non-pooled)
   connection string for migrations. Runtime pooling settings are decided when the
   first database-backed route lands (#15).
2. Vercel project → **Settings** → **Environment Variables** → add `DATABASE_URL`,
   marked **Sensitive**, for **Production** and **Preview**. Use a separate database
   or branch for Preview if the provider supports it, so previews never write
   production data.
3. Apply migrations from a trusted local checkout. An explicit environment value
   overrides `.env.local`, so no secret needs to be written to disk:

   ```bash
   read -rs DATABASE_URL && export DATABASE_URL   # paste the direct URL; not echoed
   npm ci
   npm run db:migrate
   npm run db:migrate          # second run must be a no-op
   psql "$DATABASE_URL" -c "select extversion from pg_extension where extname = 'vector';"
   unset DATABASE_URL
   ```

   The query must return one row. Without `psql`, run the same `select` in the
   provider's SQL editor. Repeat for the Preview database if separate.

4. Never paste connection strings (or any secret) into code, docs, issues, PR
   comments or chat. Rotate the credential immediately if one is exposed.

## 4. Verify the deployment is private

Check every URL class from a signed-out (incognito) browser, and from a terminal:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<url>
```

| URL                                                              | Expected when protected                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Production domain (`<project>.vercel.app` and any custom domain) | Redirect to a Vercel login, not the CineMatch page              |
| Latest production deployment URL (`<project>-<hash>.vercel.app`) | Same                                                            |
| A PR preview URL                                                 | Same                                                            |
| Signed in as the owner                                           | The CineMatch page loads (confirms the deployment itself works) |

A `200` response with CineMatch HTML to a signed-out request means the deployment
is **public**. Go to Rollback / disable immediately.

Record the URLs **privately** for owner/lead review (not in a public issue). In #12,
post only the checklist results and the date, not the URLs.

## 5. Public-release gate (closed in M0)

Do **not** switch the scope away from All Deployments, disable Vercel
Authentication, create shareable links or publish any URL until **all** of these are
done and linked in #12:

- [ ] Shared **server-side** per-session budget enforcement for paid LLM calls exists.
- [ ] Shared **server-side** per-IP budget enforcement exists (shared across
      instances, not in-memory per function).
- [ ] Enforcement runs before **every** paid call, including retries, embeddings and
      reranking.
- [ ] Automated tests prove both caps: requests over each cap are refused and make
      no provider call.
- [ ] Lead review confirms the evidence, and the owner explicitly approves public release.

## Rollback / disable

If a URL is found public, a gate item regresses, or behavior is uncertain:

1. **Re-protect first:** project → **Settings** → **Deployment Protection** → Vercel
   Authentication on, scope **All Deployments**. Never "fix" something by turning
   Vercel Authentication off: that unprotects **every** existing deployment.
2. Revoke any Shareable Links or bypass secrets under the same settings page.
3. Remove or rotate environment variables tied to unverified paid integrations,
   then redeploy.
4. For a bad production build: project overview → Production Deployment tile →
   **Instant Rollback**. Hobby can only roll back to the immediately previous
   production deployment; Pro can pick any eligible one. After a rollback, pushes
   to `main` no longer go live until you click **Undo Rollback** (or run
   `vercel promote <deployment>`).
5. Open a linked issue with the evidence and remediation before trying again.

## Owner checklist for #12

Keep #12 blocked until the owner posts evidence (no URLs or secrets) that:

- [ ] Team default and project protection are **All Deployments + Vercel Authentication**.
- [ ] The repository is imported, the production branch is `main`, and a PR preview builds.
- [ ] `DATABASE_URL` is set as Sensitive, migrations ran twice, and pgvector is present.
- [ ] Signed-out checks of production, deployment and preview URLs all redirect to login.
- [ ] No Shareable Links, bypass secrets, `LLM_API_KEY` or Password Protection are configured.

The public-release gate (section 5) is tracked separately and stays open after #12.
