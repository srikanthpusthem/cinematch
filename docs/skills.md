# Task-specific development skills

Choose a matching row; read its entrypoint and only references needed for the task.
Skip skills for unrelated work. AGENTS.md, the current issue and the approved stack
remain authoritative. Existing Vitest/Playwright commands remain the testing guide.

| Task                                                   | Local skill                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Uncertain Next.js API, routing or cache behavior       | [Next.js correctness](../.agents/skills/nextjs-correctness/SKILL.md)    |
| React rendering, server data flow or bundle issue      | [React performance](../.agents/skills/react-performance/SKILL.md)       |
| Postgres schema, query, connection or privilege change | [Postgres review](../.agents/skills/postgres-review/SKILL.md)           |
| UI accessibility, interaction or responsive review     | [Web interface review](../.agents/skills/web-interface-review/SKILL.md) |

## Discovery

Canonical content lives in `.agents/skills/`; `.claude/skills/` contains relative
symlinks to the same directories. Codex and Claude support those respective local
skill locations. Discovery depends on the client, repository working directory and
skill refresh/new turn; this does not install global skills or affect unrelated
tasks. If a checkout does not preserve symlinks, use the canonical links above.
Grok and other manual-reading agents use this router; no automatic discovery is
promised. There are no tool dependencies, remote installers or auto-update hooks.

CLAUDE.md and GROK.md now route conditionally to operations/product detail, while
requiring AGENTS.md and the current ticket. This avoids making both full documents
a mandatory pre-read; relevant constraints must still be consulted.

## Sources and adaptations

[Exact-file manifest](skills-sources.json) records source URLs, immutable revisions
and SHA-256 hashes. Selected upstream references and included license texts retain
exact bytes. Routers are locally written/adapted and are not upstream originals.
Updates require a reviewed change to selection, revision, licenses and hashes.

- **React:** [Vercel agent-skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices),
  revision `063bee94c3f4df8453406c830b0a7df0f2860278`. Eight selected rules support
  server isolation, authorization, fetch flow, serialization, bundles and derived
  state. Upstream SKILL/README declare MIT; author metadata is Vercel and README
  credits @shuding at Vercel. No standalone root LICENSE was found; see preserved
  [attribution notice](../.agents/skills/react-performance/NOTICE.md). The large
  compiled AGENTS.md, broad rule catalog, SWR/better-all/LRU examples are excluded.
- **Postgres:** [Supabase agent-skills](https://github.com/supabase/agent-skills/tree/551274ed2fe97c8fea1325f7ceb05803a542f8df/skills/supabase-postgres-best-practices),
  revision `551274ed2fe97c8fea1325f7ceb05803a542f8df`. Eight provider-neutral rules
  cover this repository's query/schema/connection needs. Preserved
  [MIT license](../.agents/skills/postgres-review/LICENSE), copyright 2026 Supabase.
  Supabase Auth/product setup and broad administration guidance are excluded.
- **UI:** [Vercel interface checklist](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md),
  revision `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`. Preserved
  [MIT license](../.agents/skills/web-interface-review/LICENSE), copyright 2025
  Vercel Labs. Locally authored review router replaces the floating-main fetch in
  [the upstream wrapper](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md).
- **Next.js:** locally authored router, no copied upstream manual. Uses installed
  version-matched docs following [official guidance](https://nextjs.org/docs/app/guides/ai-agents).
  [Next-skills retirement notice](https://github.com/vercel-labs/next-skills/blob/c522619e45aa3492fd2bfc916b308b275eff7798/README.md)
  at `c522619e45aa3492fd2bfc916b308b275eff7798` favors bundled docs. Missing docs
  require setup or a version-qualified official fallback, not a stale skill bundle.

No generic Python testing bundle, duplicated testing policy or additional runtime
package is included. Performance claims in references are illustrative upstream
claims, not measured CineMatch improvements.

## Context size

Measurements count UTF-8 bytes and whitespace-separated words; bytes divided by
four is only an approximate token proxy, not a tokenizer result, billing estimate,
or measured saving. Canonical files count once; symlink copies are not counted.
See the PR verification evidence for the measured values at this revision.
Metadata is discovery context; full SKILL.md files activate only as relevant;
reference text is optional and should never all load by default. Provenance and
license records are maintenance evidence, not mandatory task context.
