# Project operations

Repository: https://github.com/srikanthpusthem/cinematch  
Board: https://github.com/users/srikanthpusthem/projects/3

## Current gate

M0 is active. PR #2 supplied the scaffold and its CI passed at the setup audit.
This does not establish preview deployment or complete M0. Issue #3 remains the
foundation umbrella. Issue #9 supplies tracking and shared agent instructions.
All M1+ work remains Backlog until M0 completes and Srikanth explicitly authorizes
further work. Srikanth reviews and merges; Vercel/account/billing setup stays his.

## Initial plan

| Milestone              | Planned issues | Suggested lane             | Exit                                               |
| ---------------------- | -------------: | -------------------------- | -------------------------------------------------- |
| M0 Foundation          |              6 | Astra; owner deployment    | CI, coordination and protected deployment verified |
| M1 Catalog             |              7 | Claude                     | 20k movies, 5k series, US availability             |
| M2 Recommender         |              7 | Astra                      | Five valid picks, latency target, 30 eval cases    |
| M3 Product UI          |              7 | Grok                       | Phone/laptop guest journey                         |
| M4 Accounts and polish |              5 | Allocate later             | Sync, PWA and accessibility                        |
| M5 Beta                |              4 | Owner and allocated agents | Twenty users and recorded feedback                 |

There are 36 initial planned issues, including existing issues #3–#9. Future
bug/dependency issues may increase the live total. Do not delete history to preserve
this number. The initial manifest is versioned in `scripts/project-plan.json`.

## Reproduce tracking

Prerequisites: Node.js 22+, GitHub CLI authenticated for the repository and project,
and explicit authorization to modify tracking. No additional npm dependencies.

```sh
gh auth status
# Only if project scope is missing:
gh auth refresh -h github.com -s project
DRY_RUN=1 bash scripts/setup-github-project.sh
# Inspect the dry-run output before applying:
DRY_RUN=0 bash scripts/setup-github-project.sh
```

Default execution is a dry run. A dry run makes only read requests. Setup matches
existing issues by explicit number, stable marker or exact title; refuses ambiguous
matches; preserves bodies, claims, assignees, state and existing board status; and
adds new issues to Backlog. Reruns recover from partial setup. It creates missing
labels/milestones, links the repository, and configures statuses only on an empty
board; it refuses to replace options on a populated nonstandard board. If a setup
run fails, resolve the reported cause and dry-run again before applying. Do not run
multiple setup processes concurrently.

Board statuses: **Backlog → Ready → In progress → In review → Done**. All five are
configured, including In review. If a future GitHub UI shows a table, choose a Board
layout grouped by Status and save the view; status values remain the source of truth.

Use explicit JSON fields with older `gh` versions to avoid the removed Projects
(classic) API used by default issue views:

```sh
gh issue list --repo srikanthpusthem/cinematch --state open --limit 100 \
  --json number,title,milestone,labels,assignees
gh project item-list 3 --owner srikanthpusthem --limit 1000 --format json
gh project field-list 3 --owner srikanthpusthem --format json
gh pr list --repo srikanthpusthem/cinematch --json number,title,url,headRefName
```

Read IDs from live output, never invent them. `gh project item-edit` takes the item,
project, Status field and option IDs. Add an agent label and post the claim comment
as prescribed in AGENTS.md; reread before touching code. No helper here guarantees
an atomic GitHub claim. Stop and resolve races rather than overwriting other work.

## Dependency order and shared-file coordination

- M0: coordination PR lands first; fix migration setup; verify foundation; document
  public gate and owner deployment steps; owner supplies deployment evidence; then
  close the umbrella only when all exit criteria pass.
- Data: schema and client precede ingestion/availability; those precede cron,
  quality and read endpoints. Schema/migration edits must be reserved in comments.
- Recommender: provider interface and fixtures precede embeddings/taste/filtering;
  those precede rerank/API and evaluation. Quotas must guard every paid call before
  those routes can be enabled publicly.
- UI: mock contract/shell precedes screens and guest events; full E2E follows API
  integration. Coordinate contract changes with Data and Recommender in linked issues.
- Accounts/polish depend on a working guest flow; Beta depends on all release gates.

The lane labels suggest ownership but do not launch sessions or grant repository
permissions. Private repository access still requires the owner's authorized GitHub
connection in Claude/Grok. Do not share tokens or add collaborators automatically.

## Handoff text for external sessions

Claude:

> Work in srikanthpusthem/cinematch. Read AGENTS.md and CLAUDE.md from current main,
> then inspect the CineMatch board (owner srikanthpusthem, project 3). Your proposed
> lane is Data. Respect the M0/owner gate; only claim eligible Ready work using the
> shared protocol. One issue per PR, report actual tests, and never merge. If the
> gate is closed or nothing is eligible, report waiting rather than starting work.

Grok:

> Work in srikanthpusthem/cinematch. Read AGENTS.md and GROK.md from current main,
> then inspect the CineMatch board (owner srikanthpusthem, project 3). Your proposed
> lane is UI against a mock API. Respect the M0/owner gate; only claim eligible
> Ready work using the shared protocol. One issue per PR, phone-sized verification,
> report unexecuted checks honestly, and never merge. Wait when nothing is eligible.

These are prepared handoffs, not evidence of a running Claude/Grok session. Until
the coordination PR merges, sessions must not assume its instructions are on main.
