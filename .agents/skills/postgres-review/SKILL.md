---
name: postgres-review
description: Review Postgres schema, query plans, connection usage and database privileges for relevant database changes.
---

# Postgres review

Read the reference matching the changed query or schema. Preserve Drizzle/postgres
and the approved stack. These general Postgres patterns do not select a hosting
provider, introduce Supabase products/auth, or grant access to production data.
Check examples against the actual database version and provider settings. Impact
estimates are upstream illustrations, not CineMatch measurements. Run potentially
mutating EXPLAIN ANALYZE examples only on appropriate disposable test data.

- Slow filters/joins: [missing indexes](references/query-missing-indexes.md),
  [composite indexes](references/query-composite-indexes.md).
- Relationships/integrity: [foreign-key indexes](references/schema-foreign-key-indexes.md),
  [constraints](references/schema-constraints.md).
- Connection pressure: [pooling](references/conn-pooling.md),
  [prepared statements](references/conn-prepared-statements.md).
- Database roles: [least privilege](references/security-privileges.md).
- Evidence for tuning: [query plans](references/monitor-explain-analyze.md).

Follow the migration ownership and verification rules in AGENTS.md. This locally
adapted router selects exact Supabase-authored references under the included MIT
[license](LICENSE); [provenance](../../../docs/skills.md) records revisions.
