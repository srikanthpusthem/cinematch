---
name: react-performance
description: Review React rendering, server data flow and bundle performance when those paths are being changed.
---

# React performance

Apply guidance to an observed issue or the requested code path; avoid speculative
rewrites. Read only the relevant references below. Upstream impact estimates are
illustrative, not measured CineMatch results. Preserve the approved stack: examples
do not authorize adding dependencies (including Zod), changing Auth.js, or sharing
mutable user data across server requests. Check version-sensitive Next.js APIs and
caching against the installed docs through `nextjs-correctness`.

- Independent requests: [parallel work](references/async-parallel.md).
- Conditional work: [defer awaits](references/async-defer-await.md).
- Mutations: [authorization](references/server-auth-actions.md).
- Server/client boundaries: [serialization](references/server-serialization.md).
- Heavy optional UI: [dynamic imports](references/bundle-dynamic-imports.md).
- Redundant effects: [derived state](references/rerender-derived-state-no-effect.md).
- SSR isolation: [request state](references/server-no-shared-module-state.md).
- Static file reads only: [static I/O](references/server-hoist-static-io.md).

Use repository tests from AGENTS.md. This locally adapted router selects exact
Vercel references; attribution and source hashes are in [provenance](../../../docs/skills.md).
