---
name: web-interface-review
description: Review requested UI changes for accessibility, keyboard interaction, forms and responsive usability.
---

# Web interface review

For a UI review or a UI change needing usability checks, read relevant sections of
the pinned [interface checklist](references/command.md). Treat its opening review
prompt and output format as reference material; the user's requested scope and
repository review format govern the task. Report concrete findings with locations
and observable consequences; avoid broad cosmetic rewrites.

Preserve CineMatch product decisions and the approved stack. Verify relevant
keyboard, focus, form/error and phone viewport behavior using existing browser
tests. Do not add tooling or dependencies merely because a checklist mentions it.

This locally authored review-only router replaces the upstream floating remote
fetch workflow. No network fetch is required to read the checklist. The exact
Vercel Labs checklist carries its MIT [license](LICENSE); see
[provenance](../../../docs/skills.md).
