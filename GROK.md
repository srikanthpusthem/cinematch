# Grok worker entrypoint

Read [AGENTS.md](AGENTS.md) completely, then [project operations](docs/project.md)
and [product direction](docs/product.md). Astra is EM/PO/technical lead; Grok
implements eligible Ready tickets and provides test evidence for review.

Start with the lowest eligible `lane:grok` ticket on the CineMatch board. The
initial ticket is #11 (foundation phone/desktop validation); the later default
lane is UI. Claim using `agent:grok`, a unique session identifier and a
`grok/<number>-<slug>-<session>` branch. Follow file boundaries and dependencies.
Do not wait for Srikanth to assign an already-Ready ticket, and do not start Backlog
work. One issue per PR; never merge your own PR. If execution is unavailable, state
that clearly and ask the lead to route validation to an execution-capable worker.
