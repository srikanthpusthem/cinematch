# Project operations

Repository: https://github.com/srikanthpusthem/cinematch  
Board: https://github.com/users/srikanthpusthem/projects/3

## Operating model

Srikanth appointed Astra as engineering manager, product owner and senior technical
lead. Astra decides the roadmap and technical direction, writes and prioritizes
issues, releases work, coordinates dependencies, reviews PRs and judges acceptance
against evidence. Worker agents implement; the owner does not assign every ticket.
Srikanth retains final merges and account/billing/Vercel actions.

The initial scaffold landed in PR #2. M0 is still incomplete, but its remaining
work no longer requires a single implementation agent. The lead has split it into
three separate pickup tickets:

| Worker       | First ticket               | Scope                                               | Shared-file restriction                                           |
| ------------ | -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| Claude       | #10 Database setup         | Environment loading, migration verification         | Owns necessary migration CI changes; coordinate before editing CI |
| Grok         | #11 Foundation validation  | Playwright phone/desktop tests and test evidence    | `playwright.config.ts`, `e2e/`; no CI or database edits           |
| Codex worker | #13 Public deployment gate | Release checklist and owner deployment instructions | New `docs/deployment.md`; no paid endpoint or secret changes      |

These tickets become claimable when marked Ready. Their detailed lead brief in the
issue defines current acceptance and dependencies. Lane routing is not a claim or
proof of a running session. Until PR #39 merges, read the draft AGENTS.md linked
from each ticket together with the current-main rules and the lead's issue brief.

Astra stays in management/review capacity. The existing coordination PR is management
infrastructure, not a commitment for Astra to implement application features.

## Milestones and dependency gates

| Milestone              | Initial planned issues | Default worker lane                 | Outcome                                            |
| ---------------------- | ---------------------: | ----------------------------------- | -------------------------------------------------- |
| M0 Foundation          |                      6 | Claude/Grok/Codex; owner deployment | Verified build, CI, setup and deployment           |
| M1 Catalog             |                      7 | Claude                              | Trustworthy US catalog and availability            |
| M2 Recommender         |                      7 | Codex workers                       | Useful, valid picks outperform a measured baseline |
| M3 Product UI          |                      7 | Grok                                | Fast, simple phone/laptop guest journey            |
| M4 Accounts and polish |                      5 | Lead allocates                      | Optional sync, PWA, accessibility and privacy      |
| M5 Beta                |                      4 | Lead allocates; owner release       | Twenty-user evidence and improvements              |

The initial 36 issues include existing #3–#9. Milestones and counts may evolve when
new evidence warrants it. Do not manufacture scope just to preserve a count.
The live board is authoritative; the manifest is an initial bootstrap plan.

- Only the lead promotes Backlog to Ready and changes cross-lane priorities.
- Workers pick the lowest-numbered eligible ticket in their released lane. Use the
  claim protocol in AGENTS.md. Maximum one active implementation ticket per session.
- #10 and #11 can run independently. The lead combines database evidence from #10
  with browser evidence from #11 before accepting the foundation umbrella #3.
- #13 produces the exact deployment procedure for owner issue #12. Owner clicks and
  real deployment evidence remain required; documentation alone cannot close #12.
- Data schema/client precede ingestion/availability, then refresh and quality checks.
- Recommender interfaces/fixtures precede retrieval, filters, ranking and evaluation.
  Enforced quotas are required before paid endpoints become public.
- UI can use mocks once its contract is approved. End-to-end integration waits for
  the real API. The lead may open independent fixture/mock work without waiting
  for account setup; this never waives milestone exit or public-release requirements.
- Shared contracts, migrations, lockfile and CI require explicit coordination.

## Worker pickup loop

1. Read AGENTS.md, the issue brief, comments, dependencies and current board status.
2. Find an eligible Ready ticket for your lane; confirm no assignee, active claim or
   blocked label. Claim and reread to detect races before editing.
3. State acceptance criteria, file scope and a short plan when changing >3 files.
4. Implement in an isolated branch, test, open one PR with `Closes #N` and evidence.
5. Move to In review and notify the lead in an issue comment with the PR link,
   commands/results, assumptions and blockers. Do not merge or self-certify Done.
6. Address review. If blocked, explain why and release only through an explicit
   handoff. Do not silently expand scope or steal another worker's issue.

External sessions need their own authorized repository/Projects access. This file
does not launch Claude/Grok, install integrations or share tokens. A worker without
shell/browser capabilities must report that limitation rather than invent results.

## Reproduce tracking

Requires Node.js 22+ and GitHub CLI with repository access and `project` scope.

```sh
gh auth status
# If project scope is missing:
gh auth refresh -h github.com -s project
DRY_RUN=1 bash scripts/setup-github-project.sh
# Read the plan before applying:
DRY_RUN=0 bash scripts/setup-github-project.sh
```

Default execution is read-only. Setup matches historical numbers, stable markers
or exact titles, rejects ambiguity, preserves existing issue bodies/claims/state
and meaningful board statuses, and adds new work to Backlog. Reruns recover missing
item status only when the item has no active claimant. It does not synchronize later
product or routing changes into existing bodies; the lead updates those explicitly.
Do not run multiple setup processes concurrently. All five statuses are configured:
Backlog, Ready, In progress, In review, Done.

Use explicit JSON fields with older GitHub CLI versions:

```sh
gh issue list --repo srikanthpusthem/cinematch --state open --limit 100 \
  --json number,title,milestone,labels,assignees
gh project item-list 3 --owner srikanthpusthem --limit 1000 --format json
gh project field-list 3 --owner srikanthpusthem --format json
gh pr list --repo srikanthpusthem/cinematch --json number,title,url,headRefName
```

Use live item/field/option IDs when editing board status. Multi-step GitHub claims
are not atomic: unique session IDs and rereading comments prevent silent collisions.

## External-session handoff

> Work in srikanthpusthem/cinematch under Astra's EM/PO/technical leadership. Read
> AGENTS.md and your worker entrypoint (CLAUDE.md or GROK.md), inspect owner
> srikanthpusthem's project 3, and pick the lowest eligible Ready ticket in your lane.
> Follow the latest lead brief, claim before coding, stay within file boundaries,
> and submit one tested PR per issue. Report facts, failures and blockers to Astra.
> Do not merge. When no eligible ticket exists, report idle rather than invent work.
