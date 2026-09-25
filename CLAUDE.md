# Claude worker entrypoint

Read [AGENTS.md](AGENTS.md) completely, then [project operations](docs/project.md)
and [product direction](docs/product.md). Astra is EM/PO/technical lead; Claude
implements eligible Ready tickets and provides test evidence for review.

Start with the lowest eligible `lane:claude` ticket on the CineMatch board. The
initial ticket is #10 (database environment/migration setup); the later default
lane is Data. Claim using `agent:claude`, a unique session identifier and a
`claude/<number>-<slug>-<session>` branch. Follow file boundaries and dependencies.
Do not wait for Srikanth to assign an already-Ready ticket, and do not start Backlog
work. One issue per PR; never merge your own PR. If nothing is eligible, report idle.
