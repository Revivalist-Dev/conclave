---
title: Conclave — comprehensive upgrade plan
topic: conclave-upgrade-plan
updated: 2026-10-15
status: current
---

# Conclave — comprehensive upgrade plan

The sequencing document. It turns the four research pages beside it into an order of work, and the
order is **robustness first** — decided 2026-10-15. The reasoning is not aesthetic: every later phase
is verified by observing a failure, and a harness that answers a failure with silence cannot verify
anything. Fixing what is invisible first is what makes the rest testable.

| Input | What it supplies |
|---|---|
| [features.md](./features.md) | what the tree actually does, incl. the working / partial / **stub** ledger |
| [proxima-comparison.md](./proxima-comparison.md) | the 26-capability gap list, and what conclave has that Proxima does not |
| [mcp-roadmap.md](./mcp-roadmap.md) | the MCP surface today, the protocol checklist, and a proposed tool set |
| [danyapi-review.md](./danyapi-review.md) | the backend's real API surface and where the two ends disagree |
| [hardening-upgrades.md](./hardening-upgrades.md) | C / F / S / O / D findings, each with evidence and a test |
| [conclave.md](./conclave.md), [conclave-dependency-audit.md](./conclave-dependency-audit.md) | layout, provenance, rename footprint, dependency currency |

## Answer first — the order

1. **Make failures visible** (`F` items). Nothing else is verifiable until a broken thing looks broken.
2. **Make the paths that exist correct** (`C` items) — starting with the ones a user hits on first run.
3. **Pin the supply chain** (`S` items), because `:latest` on a fork is a dependency on somebody's
   continued goodwill.
4. **Get one real run, end to end, with a smoke test** — install, launch, one prompt through the
   backend, one MCP client call. This is the first phase that produces evidence rather than fixes.
5. **The MCP layer**, against `mcp-roadmap.md`'s checklist.
6. **Proxima parity**, in the gap list's own order.
7. **Ongoing**: the two gates below stay green, and the docs stay generated.

Each phase ends with a test that failed before the phase and passes after. A phase with no such test is
not done — it is prose.

## Phase 1 — stop the silent failures

Ranked by value-to-effort; all of these are `S` or smaller in the hardening page, and each is a place
where "nothing happened" and "something broke" currently look identical. Evidence, fix and test per
item are in [hardening-upgrades.md](./hardening-upgrades.md) §2.

| id | the shape of the silence |
|---|---|
| F1 | the send button can spin forever with no error surfaced |
| F2 | a malformed stream chunk is discarded, so a truncated stream reads as a short answer |
| F5 | non-JSON lines from a plugin's MCP server are dropped without a trace |
| F6 | plugin event-handler failures are swallowed |
| F8 | `callMcp` never settles when no response arrives |
| F9 | a floating promise at boot |
| F4 | a failed `git pull` of the provider is invisible |
| F3 | a provider failure is saved as a *successful* message |
| F10 | the already-fixed pattern still reports at the wrong severity |
| F7 | a service counts as healthy if anything on its port answers 404 |

**Why this is first.** F2 and F3 both write a *wrong success* into durable state — the message log —
which means later phases would be debugging against corrupt evidence. F8 is the MCP layer's problem
too: it is the same defect class as the bridge's `try/catch`, already fixed once at
`scripts/build-sidecar.ts`.

## Phase 2 — correctness on the paths that exist

| id | finding | why it matters now |
|---|---|---|
| **C1** | the provider session teardown calls a route that does not exist | a first-run path, and the [DanyAPI review](./danyapi-review.md) shows the two ends genuinely disagree about the route set |
| **C5** | path confinement is a **text prefix check**, so a sibling directory escapes | security-relevant, and the fix is small |
| **C3** | the supervisor marks a container `running` after `docker compose up` failed | this is what makes C2 and the UI's static "Docker Active" badge possible |
| **C2** | bootstrap reports `danyApiReady: true` for an empty directory | same happy-path selection as C3 |
| **C7** | IDs can collide and a collision **throws** | a crash on a long-running session |
| **C4** | MCP tool arguments are never validated against the advertised schema | the schema is a promise; nothing checks it (see Phase 5) |
| **C6**, **C9** | the UI offers providers the router cannot serve; upload model selection is a hardcoded two-way branch | both become moot once Phase 6's provider routing lands, so they are deliberately sequenced after it |

## Phase 3 — pin the supply chain

**S1 is the one to do first and it is the reason this phase exists:** the provider's supply chain is
**three unpinned moving references**, of which the sharpest is
`ghcr.io/mindflowgo/danyapi:latest` — an unpinned tag on a **fork** whose upstream
(`FANATATFANATA/DanyAPI`) has been deleted. If that fork is removed or retagged, conclave stops
working, and nothing in the tree records which image it was actually built against. Pin by digest and
record the digest.

Then **S2** (no CSP while the global Tauri API is exposed) and **S3** (any setting key can be written,
and one of them is a fetch target).

## Phase 4 — one real run, with a smoke test

The first phase that produces evidence. Nothing above this line requires the app to launch, and nothing
below it is verifiable without that.

- Install and launch on this machine (the Windows link defect and the missing sidecar are already
  fixed — `cargo check` exits 0 as of `595f786`).
- One prompt through the backend, end to end, with the log showing the full turn under one id
  (hardening `O4`).
- One MCP client pointed at the bridge, one tool call returning content rather than an error.
- **Then freeze it as a script**, so every later phase has a regression test rather than a memory.

## Phase 5 — the MCP layer

Work straight down [mcp-roadmap.md](./mcp-roadmap.md)'s implementation checklist. Two traps are already
measured in this workspace and must not be rediscovered:

- **A stdio bridge must handle a chunked HTTP response**, not only `Content-Length`. The Rust bridge
  does; anything new must too.
- **A failure must never be answered with silence.** The bridge emits a JSON-RPC error naming the
  endpoint; keep that property.

Also settle the roadmap's open questions first — whether the Rust bridge replaces the JS one or
coexists, and where tool-approval policy lives — because both change the shape of the work.

## Phase 6 — Proxima parity

The 26 capabilities in [proxima-comparison.md](./proxima-comparison.md) §2, in their given order, which
is by architectural weight. **Item 1 is the enabler**: "provider abstraction that actually routes" —
today `providers/index.ts:18-24` returns DanyAPI for every input, so every later provider item is
blocked behind it. Items 2–5 (browser-session engines, BYOK, the ask surface, smart routing) all assume
a router exists to route between them.

The browser-session engines (item 2) are also the largest single piece of work in this document and
carry the most product risk, because they drive a real logged-in browser. Do not start them before
Phase 4's smoke test exists, or a failure in one is indistinguishable from a failure in the harness.

## Invariants that hold through every phase

Two gates, both cheap, both currently green:

```powershell
node .cursor/tools/wiki-check.mjs        # must exit 0 - links, maps, frontmatter, agent coverage
node .cursor/tools/project-docs.mjs --check   # must exit 0 - the project's doc folder is in sync
```

- **`wiki-check`** walks this page and its six siblings through the symlinks in
  [`.cursor/documents/conclave/`](../../../../.cursor/documents/conclave/), so a page with a dead link
  fails the gate rather than rotting.
- **`project-docs --check`** fails when a page is added to this project but not mirrored, or when the
  generated map drifts. Run `--sync` to repair; never hand-edit the generated `index.md`.
- **This project's pages are the project's.** They live in
  `.agent-repositories/conclave/.cursor/documents/`, which is gitignored, so they are never committed
  to the fork — and their links are written relative to the project, so renaming the project's folder
  cannot break them.

## What to do first, concretely

If the next session has one thing: **Phase 1's F2 and F3.** They are small, they are in the same file
family, and they are the two items that corrupt the message log — which every later phase will read as
evidence.

## Related

- [The project's own map](./index.md)
- [Conclave — provenance, layout, and the rename footprint](./conclave.md)
- [Conclave dependency audit](./conclave-dependency-audit.md)
- [Complete feature inventory](./features.md)
- [Proxima comparison](./proxima-comparison.md)
- [MCP layer scaffold](./mcp-roadmap.md)
- [DanyAPI review](./danyapi-review.md)
- [Hardening and upgrades](./hardening-upgrades.md)
