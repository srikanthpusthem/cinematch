# Claude worker entrypoint

Read [AGENTS.md](AGENTS.md) completely and the current ticket. Consult
[project operations](docs/project.md) for unresolved workflow/dependency context
and relevant [product direction](docs/product.md) sections for product/stack decisions.
Astra is EM/PO/technical lead; Claude
implements eligible Ready tickets and provides test evidence for review.

Start with the lowest eligible `lane:claude` ticket on the CineMatch board. The
initial ticket is #10 (database environment/migration setup); the later default
lane is Data. Claim using `agent:claude`, a unique session identifier and a
`claude/<number>-<slug>-<session>` branch. Follow file boundaries and dependencies.
Do not wait for Srikanth to assign an already-Ready ticket, and do not start Backlog
work. One issue per PR; never merge your own PR. If nothing is eligible, report idle.

## Task-specific skills

Use the compact [skill router](docs/skills.md) when its topic matches the task;
read only the relevant skill and references. Existing project rules remain authoritative.
