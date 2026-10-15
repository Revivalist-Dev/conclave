# Conclave — project-local agent config

This is the project's own `.cursor/`. Only `.cursor/documents/` and this README are versioned; the
rest of `.cursor/` is gitignored, so hooks, tools and scratch stay local.

## The wiki

`documents/` is Conclave's wiki, and `documents/index.md` is the map — **read that first.** Start with
`upgrade-plan.md` if you are about to change the project: it sequences the work robustness-first, from
the failure-visibility findings through to Proxima feature parity.

**One caveat for a reader outside the parent workspace.** Some pages link to
`../../../../.cursor/documents/...`, which is another repository's wiki — Zenon's, the workspace this
fork was developed inside. Those links resolve there and **not in a bare clone of this repo.** They are
left as links rather than flattened because they are how the pages are validated in that workspace, and
because they name where the mirrored copies live. Everything else on the pages is relative to this
directory and resolves normally.