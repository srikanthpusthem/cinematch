# Grok worker entrypoint

Read [AGENTS.md](AGENTS.md) completely and the current ticket. Consult
[project operations](docs/project.md) for unresolved workflow/dependency context
and relevant [product direction](docs/product.md) sections for product/stack decisions.
Astra is EM/PO/technical lead; Grok
implements eligible Ready tickets and provides test evidence for review.

Start with the lowest eligible `lane:grok` ticket on the CineMatch board. The
initial ticket is #11 (foundation phone/desktop validation); the later default
lane is UI. Claim using `agent:grok`, a unique session identifier and a
`grok/<number>-<slug>-<session>` branch. Follow file boundaries and dependencies.
Do not wait for Srikanth to assign an already-Ready ticket, and do not start Backlog
work. One issue per PR; never merge your own PR. If execution is unavailable, state
that clearly and ask the lead to route validation to an execution-capable worker.

## Task-specific skills

Use the compact [skill router](docs/skills.md) when its topic matches the task;
read only the relevant skill and references. Existing project rules remain authoritative.
