# CineMatch shared agent rules

Read this file completely before changing files or claiming work. It applies to
Astra/Codex, Claude, Grok and human contributors. `CLAUDE.md` and `GROK.md` are
entrypoints, not separate sources of policy. Direct owner instructions take
precedence. Do not change these rules merely to bypass a gate.

## Source of truth

- Product sponsor and final merge authority: Srikanth (`srikanthpusthem`).
- Astra is EM/PO/technical lead: owns roadmap, product/architecture decisions, issue
  acceptance, prioritization, dependency gates, delegation and technical review.
- Implementation belongs to worker agents. Astra does not take routine coding
  tickets; it prepares work, reviews evidence and resolves cross-lane decisions.
- Claude, Grok and Codex workers claim eligible tickets; Srikanth is not required
  to assign each ticket or approve routine product and engineering decisions.
- Repository: https://github.com/srikanthpusthem/cinematch
- Board: https://github.com/users/srikanthpusthem/projects/3
- Product and approved stack: [docs/product.md](docs/product.md).
- Milestone gates, lanes and handoffs: [docs/project.md](docs/project.md).
- Initial issue plan: `scripts/project-plan.json`. Live issues and board determine
  current work. The manifest is a bootstrap plan, not authority to reset progress.

## Read, choose, claim

1. Read the issue, linked dependencies, open PRs and current board state. Use
   `gh auth status` and require the `project` scope. If missing, stop and give the
   owner `gh auth refresh -h github.com -s project`. Never expose tokens.
2. Only take **Ready** work explicitly released by the lead. It must have no assignee,
   no `blocked` label and no `agent:*` label or unreleased claim comment. Choose
   the lowest issue number in the lowest eligible milestone unless the owner or
   lead has explicitly allocated another lane. `lane:*` is a suggestion, not a claim.
3. Refresh the issue immediately before claiming. Add your `agent:astra`,
   `agent:claude`, `agent:codex` or `agent:grok` label; move to **In progress**; comment
   `Claimed by <agent>, branch <agent>/<number>-<short-slug>, session <unique-id>`.
   Include a short unique session suffix in new branch names to distinguish two
   sessions of the same agent. Keep the claim-comment URL as the claim identity.
4. Reread labels, status and comments before editing. GitHub multi-step claims are
   not atomic. If concurrent claims appear, the earliest valid claim comment wins;
   the later claimant comments withdrawal referencing their own claim-comment URL
   and stops. Remove their agent label only if the winning claim uses a different
   label; two sessions of the same agent must preserve the shared label. Do not
   overwrite another claimant's status. Escalate ambiguity to lead.
5. Record acceptance criteria and expected files before starting. For changes to
   more than three files, post a short implementation and verification plan.
6. One issue, one branch, one PR. Use an isolated clone/worktree when other agents
   share a machine; do not change another agent's checkout. Branch from current
   `main` and rebase on `origin/main` before opening a PR.

## Delivery and blockers

- Never push to `main`, merge your own PR, or mark unverified work Done.
- PR body: `Closes #N`, behavior changed, exact tests/results, assumptions and
  review risks. Move the issue to **In review** once the PR exists.
- Owner merges after green CI and review. **Done** additionally requires acceptance
  evidence and a phone-sized viewport check for UI changes. Closed alone does not
  prove done. Keep `agent:*` through review; remove after merge/verification or an
  explicit documented handoff. Do not silently reclaim stalled work.
- If blocked or scope is wrong, comment what you found, add `blocked`, and stop
  that issue. Keep status reflecting the actual stage; the label signals blockage.
  Only lead/owner clears a block after its cause is resolved.
- Stay within issue scope. Open and link a separate issue for needed changes
  elsewhere. Do not silently broaden a PR or duplicate existing issues.
- Shared files (`package.json`, lockfile, CI, schema migrations) need coordination
  in issue comments. Keep edits minimal and never reformat shared files incidentally.
  Pull main before allocating migration numbers; later conflicting PRs rebase and
  renumber. Do not add dependencies outside the approved stack without owner approval.

## Verification and safety

Run and report `npm ci`, `npm run lint`, `npm run format`, `npm run typecheck`,
`npm run test` and `npm run test:e2e` as applicable. Tracking-script logic additionally
uses `node --test scripts/setup-github-project.test.mjs`. New logic needs meaningful
tests. If execution is unavailable, state exactly what was not run in the PR;
never weaken tests or describe unexecuted code as verified. CI is required.

Never commit secrets. Keep `.env.example` current and actual keys in ignored
`.env.local` / owner-managed Vercel variables. Vercel/account/billing clicks are
owner-only; agents write exact instructions in an issue. Before any public link,
verify shared, server-side per-session and per-IP caps on all paid LLM calls.
Until then deployment stays protected. Do not buy services, choose commercial
licensing, change availability provider or expand beyond US without owner decision.

## Delegation and milestone gates

Srikanth explicitly appointed Astra as EM/PO/technical lead. The lead can revise
milestones and acceptance criteria, release dependency-ready tickets and allocate
lanes without asking Srikanth for every routine decision. Do not infer that all
Backlog issues are available: Ready is the explicit pickup authorization.

The single-agent scaffold phase is complete through merged PR #2. Remaining M0
work can now be delegated in non-overlapping scopes: Claude handles database setup,
Grok handles foundation browser validation, and a Codex worker handles deployment
gate documentation. M0 remains incomplete until its actual exit criteria pass.

After foundation, the default lanes are Claude for Data, Codex workers for
Recommender, and Grok for UI. The lead controls dependency gates and may release
fixture/mock work independently of live integrations. Lane labels are routing,
not an active claim. Maximum one active implementation ticket per worker session;
hand off for review before taking another. Never mark a session running without
an actual claim or execution acknowledgement.

Srikanth still handles final merges and account/billing/Vercel clicks. Public
release, paid services, commercial licensing and country expansion retain the
explicit owner boundaries above. The lead reports outcomes, failures, risks and
owner actions; it does not ask the owner to micromanage normal implementation.

## Task-specific skills

Use the compact [skill router](docs/skills.md) when its topic matches the task;
read only the relevant skill and references. Existing project rules remain authoritative.
