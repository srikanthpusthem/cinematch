# GHSA-67mh-4wv8-2f99 development-tool mitigation

Last reviewed: 2026-09-28

## Decision

Accept the limited development-tool risk until Drizzle publishes a supported
release that removes the deprecated `@esbuild-kit/esm-loader` chain. Do not apply
the npm-suggested forced downgrade or an unsupported transitive override. Recheck
this decision when `drizzle-kit` releases a version after `0.31.11`, or by
2026-12-31, whichever happens first.

This is not an audit-clean result. A clean install currently reports four
moderate findings that trace to one advisory.

## Verified dependency chain

The committed lockfile installs this development-only path:

```text
drizzle-kit@0.31.11
└─ @esbuild-kit/esm-loader@2.6.5
   └─ @esbuild-kit/core-utils@3.3.2
      └─ esbuild@0.18.20
```

`npm audit --json` reports four moderate entries (`drizzle-kit`, both
`@esbuild-kit` packages, and `esbuild`) because the same vulnerable `esbuild`
node propagates through the chain. `npm audit --omit=dev --json` reports zero
production vulnerabilities, and `npm ls --omit=dev` contains none of these
packages.

The [GitHub-reviewed advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
affects esbuild versions through `0.24.2` and is patched in `0.25.0`. Its attack
requires esbuild's development server: a user visits a malicious site while the
server is running, and permissive CORS lets that site read served content.

The vulnerable nested copy is used by a TypeScript module loader. Inspection of
the installed `@esbuild-kit/core-utils` and `@esbuild-kit/esm-loader` distributions
found no call to esbuild's `serve` API. The upstream loader repository also says
the project is [unmaintained and merged into
`tsx`](https://github.com/esbuild-kit/esm-loader). The current upstream
[`drizzle-kit` package manifest](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/package.json)
still directly depends on that deprecated loader, so upgrading within the
supported stable line does not remove this path. The upstream Drizzle tracker
has an [open report for the dependency
chain](https://github.com/drizzle-team/drizzle-orm/issues/5481).

## Mitigation and operating rule

- Use `drizzle-kit` only for the repository's migration commands in a trusted
  local checkout or CI runner.
- Do not expose or invoke an esbuild development server through this dependency
  chain. CineMatch does not configure one.
- Do not run migration tooling against untrusted branches or configuration with
  production credentials.
- Keep production installs free of development dependencies.
- Do not suppress the advisory globally; the normal full audit must continue to
  display it until the dependency is actually removed.

`npm audit fix --force` proposes `drizzle-kit@0.18.1`. That is a major downgrade
from the locked migration tool and is not a supported security update. Forcing
the nested esbuild version beyond `@esbuild-kit/core-utils`' declared
`~0.18.20` range would likewise be an unverified compatibility override. Neither
change is accepted.

## Reverification commands

Run these after any Drizzle dependency update and at the review date above:

```bash
npm ci
npm audit --json
npm audit --omit=dev --json
npm ls drizzle-kit @esbuild-kit/esm-loader @esbuild-kit/core-utils esbuild --all
npm run lint
npm run typecheck
npm run test
npm run test:db
```

Removal is complete only when a clean full audit no longer reports this advisory
and migration verification still passes. Do not describe the issue as resolved
solely because production dependencies remain unaffected.
