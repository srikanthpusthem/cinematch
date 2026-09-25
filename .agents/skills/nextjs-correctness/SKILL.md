---
name: nextjs-correctness
description: Resolve uncertain Next.js App Router APIs, server/client boundaries, routing and caching using installed version-matched documentation.
---

# Next.js correctness

When Next.js behavior is uncertain, use documentation shipped with the installed
version before applying remembered APIs or version-sensitive React examples.
Read the installed `next/package.json` version, then search
`node_modules/next/dist/docs` for the specific symbol/topic. Read only the matching
section. Paths are relative to the repository root.

Common entrypoints under `node_modules/next/dist/docs/01-app/01-getting-started/`:

- `05-server-and-client-components.md`: component boundaries and serialization.
- `06-fetching-data.md`: fetching and streaming.
- `15-route-handlers.md`: request/response handlers.
- `10-error-handling.md`: expected errors and boundaries.

For cache APIs and invalidation, search the installed API reference for the exact
symbol rather than loading the documentation tree. Check experimental status and
configuration before adopting an example. Installed version-specific behavior
supersedes conflicting generic performance advice.

If dependencies are absent, use the repository's `npm ci` setup. If bundled docs
remain unavailable, consult official Next.js documentation matching the locked
version; state any unresolved version mismatch. Do not change dependencies to
obtain docs. Existing tests and product constraints remain authoritative.

Locally authored; rationale and source links: [provenance](../../../docs/skills.md).
