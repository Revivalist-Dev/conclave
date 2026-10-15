---
title: Conclave — provenance, layout, and the rename footprint
topic: conclave
updated: 2026-10-15
status: current
---

# Conclave — provenance, layout, and the rename footprint

**Conclave** is this tree: a Tauri v2 desktop shell over a
SvelteKit 5 front end, a Bun/TypeScript orchestrator holding a `bun:sqlite` store, and a Docker container
that supplies the local LLM backends. The fork `Revivalist-Dev/conclave` is a real GitHub fork of
`mindflowgo/brAInstorm`. The rename from `brAInstorm` to Conclave is commit `1dd4aec`, and
`git show --stat 1dd4aec` puts its blast radius at **46 paths — 32 content-modified and 14 renamed
assets, 138 insertions against 138 deletions**, so no line was added without one removed. The
pre-rename tip is `2759cb5`. As measured at 10:15 on 2026-10-15, `main` and `origin/main` sit at
`d4f3235`, the dependency upgrade that landed after the rename, while the local branch
`rename/conclave` still points at `1dd4aec` — the tree is being actively committed to, so re-read its
tips before relying on them.

This page covers what the project is, what a rename of it has to touch, and the one external service it is
coupled to. Every claim below was read out of the working tree on 2026-10-15 with `rg` at
`$env:CURSOR_RIPGREP_PATH --hidden`; the tree was being committed to during the session (Section 6).

## 1. Provenance — what the tree says about its own origin

The tree says almost nothing, and the absences are the finding.

| Evidence | Exact string | What it establishes |
|---|---|---|
| [`LICENSE:3`](../../LICENSE) | `Copyright (c) 2026 MindFlow` | the copyright holder — **the only author identity anywhere in the tree** |
| [`package.json:2`](../../package.json) | `"name": "conclave-workspace"` | a package slug, not a repository |
| [`orchestrator/package.json:2`](../../orchestrator/package.json) | `"name": "conclave-orchestrator"` | package slug |
| [`client/web/package.json:2`](../../client/web/package.json) | `"name": "conclave-harness"` | package slug |
| [`client/tauri/package.json:2`](../../client/tauri/package.json) | `"name": "tauriclient"` | package slug, **not renamed** |
| [`client/tauri/src-tauri/Cargo.toml:2`](../../client/tauri/src-tauri/Cargo.toml) | `name = "tauriclient"` | the Rust crate name, **not renamed** |
| [`client/tauri/src-tauri/Cargo.toml:5`](../../client/tauri/src-tauri/Cargo.toml) | `authors = ["Conclave"]` | a self-name, neither person nor org |
| [`client/web/README.md:15`](../../client/web/README.md) | ``This project was created using `bun init` in bun v1.3.14.`` | a scaffold marker, not an origin — and the **only README in the tree** |
| [`skills/skill-prompts.cjs:7`](../../skills/skill-prompts.cjs) | `const LEGACY_APP_DATA_DIRS = ['proxima'];` | **the lineage** — it inherits Proxima's app-data directories |
| [`skills/skill-prompts.cjs:26`](../../skills/skill-prompts.cjs) | `process.env.PROXIMA_SKILLS_DIR` | a Proxima-era fallback it still honours |

**Absent, and verified absent:** a root `README.md` (the root holds only `.gitignore`, `LICENSE`, the four
documents and the five directories); and any `repository`, `homepage`, `bugs`, `author` or `contributors`
key — `rg` over every `*.json` in the tree exits 1 with no match. The only `README.md` is the untouched
`bun init` scaffold at [`client/web/README.md`](../../client/web/README.md).

The origin is therefore recoverable only from outside the tree, and it is a **fork** relationship rather
than a match on a name:

- upstream — [`mindflowgo/brAInstorm`](https://github.com/mindflowgo/brAInstorm), MIT, "A lightweight
  harness to allow accessing your models", default branch `main`, last pushed 2026-09-15 (verified);
- fork — [`Revivalist-Dev/conclave`](https://github.com/Revivalist-Dev/conclave), whose GitHub `parent`
  field resolves to `mindflowgo/brAInstorm` (verified 2026-10-15), so the fork exists and the local
  checkout's `main` at `2759cb5` is the pre-rename tip.

The `Proxima` fallbacks are the one lineage claim the tree supports about itself: it descends from the
retired Proxima harness rather than from a public project, and `mindflowgo/brAInstorm` is where that work
was published. That the tree is a source-archive extract — no `.git`, no remote — is recorded in
[the project documentation map](./index.md) as a property of how this checkout came to be here.

## 2. Layout and architecture

Conclave is documented by its own [`ARCHITECTURE.md:3`](../../ARCHITECTURE.md)
as a three-layer system: a client layer (`client/tauri` native shell + `client/web` SvelteKit UI), an
orchestrator layer (Bun/TypeScript HTTP + WebSocket hub on port 4000 with `bun:sqlite`), and a
containerised engine layer (DanyAPI on Docker, port 8000). The layers are strictly separated — the Tauri
process owns one WebSocket to `ws://127.0.0.1:4000/ws` and carries no protocol knowledge, and the Svelte UI
talks to the orchestrator either over that socket's IPC bridge or over HTTP for uploads.

**The five manifests.** Each is a separate package with its own identity, and the dependency audit is
[the companion page](./conclave-dependency-audit.md).

| Manifest | npm/Rust name | What it is |
|---|---|---|
| [`package.json`](../../package.json) | `conclave-workspace` | the workspace root: **scripts only, zero dependencies** — `dev`, `build`, `build:sidecar`, `web:dev`, `web:build`, `orchestrator:dev`, `orchestrator:start` |
| [`orchestrator/package.json`](../../orchestrator/package.json) | `conclave-orchestrator` | the Bun backend: HTTP + WS server, SQLite repos, LLM router, MCP server, plugin engine, Docker supervisor. **Both dependency blocks are empty** (`{"dependencies": {}}` at line 8, `{"devDependencies": {}}` at line 9) — it leans entirely on Bun built-ins |
| [`client/web/package.json`](../../client/web/package.json) | `conclave-harness` | the SvelteKit 5 + Tailwind 4 UI, dual-mode (`(desktop)` and `overlay` route groups). Carries 13 devDependencies and 2 dependencies — the tree's only substantial npm surface |
| [`client/tauri/package.json`](../../client/tauri/package.json) | `tauriclient` | the Tauri CLI wrapper: `tauri dev` / `tauri build`, plus `build:sidecar` delegating to the root script. One devDependency |
| [`client/tauri/src-tauri/Cargo.toml`](../../client/tauri/src-tauri/Cargo.toml) | crate `tauriclient`, lib `tauriclient_lib` | the Rust shell: WS transport (`orchestrator_ws.rs`), orchestrator side-loader (`orchestrator_loader.rs`), native window state and the `~/.conclave.json` config path. Nine dependencies |

Beside the manifests: `skills/` (seven Markdown prompt templates plus the `skill-prompts.cjs` registry
loader), `scripts/build-sidecar.ts` (the only build script, compiling both sidecar binaries), `docs/LLMS.md`
(a five-line note of model-provider ideas — Perplexity, OpenRouter), `assets/` (app icons and provider
logos), and the four design documents.

The four documents, two sentences each:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) (752 lines) — the system
  specification: the three layers as ASCII diagrams, the orchestrator's HTTP surface and SQLite schema, the
  LLM router and provider adapters, the plugin system, the DanyAPI Docker supervisor, and the multipart
  upload flow. It is the single place the tree states its own API contract, including the endpoints
  (`POST /api/upload`, `POST /mcp`, `GET /api/tabs`, `GET /health`) and the DanyAPI image and port.
- [`UI.md`](../../UI.md) (216 lines) — the UI specification: a two-pane
  split with a floating prompt dock, the sidebar's project → thread hierarchy, and the collapsible widget
  rules (user messages over one paragraph, code blocks over fifteen lines, tool-step pills). It is the
  authority for why the sidebar shows the top six threads per project with a "Show all (X)" expander.
- [`UI-PROTOCOL.md`](../../UI-PROTOCOL.md) (307 lines) — the wire protocol
  between client and orchestrator: the six-step startup handshake (`SERVER_READY` → `LOAD_SETTINGS` →
  `SETTINGS_LOADED` → `TAB_FETCH` → `TAB_DETAIL`), the message envelope with its required `type` field, and
  the Base58 ID scheme (3 chars project, 4 chars tab, 12 chars message). It is the document a second client
  would be written against.
- [`FUTURE.md`](../../FUTURE.md) (34 lines) — an "icebox", not a
  specification: a single OpenRouter `requests.post` snippet and a list of inspiration links (`OpenCursor`,
  `anomalyco/opencode`, `ponytail`, RTK, AgentMemory). Nothing in it is implemented, and nothing else in
  the tree references it.

## 3. Referenced but absent

Four paths are named by the tree and are not in it. All four are gitignored, which is why a clone cannot
build them back:

| Path | Referenced at | Why it is absent |
|---|---|---|
| `crates/` (the `conclave-mcp` Rust CLI) | [`scripts/build-sidecar.ts:14`](../../scripts/build-sidecar.ts) compiles `crates/conclave-mcp/src/main.rs` | [`\.gitignore:21`](../../.gitignore) ignores `crates/` wholesale |
| `api_sandbox/` (the DanyAPI Docker Compose project) | [`orchestrator/src/bootstrap/index.ts:44`](../../orchestrator/src/bootstrap/index.ts) clones into `sandboxDir/DanyAPI` | [`.gitignore:17`](../../.gitignore) ignores `api_sandbox` |
| `orchestrator/data/` (the SQLite file) | [`orchestrator/src/db/index.ts:11`](../../orchestrator/src/db/index.ts) joins `conclave.db` onto `DATA_DIR` | [`.gitignore:16`](../../.gitignore) ignores `data/` |
| `client/tauri/src-tauri/binaries/` (the compiled sidecars) | [`scripts/build-sidecar.ts:15`](../../scripts/build-sidecar.ts) writes both binaries there | [`.gitignore:23`](../../.gitignore) ignores it |

**The `crates/` omission is a real build blocker, and it is the worst of the four.** The other three are
generated at runtime or by the build; `crates/conclave-mcp/` is hand-written Rust source that no command
regenerates. A clone of `Revivalist-Dev/conclave` therefore cannot produce `binaries/conclave-mcp-<triple>`,
and because the reference to it sits inside a `try { … } catch {}` (see Section 4), the failure is
**silent**: the build appears to succeed and the bundle ships without its MCP sidecar. Building the desktop
app from a fresh clone requires the `crates/` tree, which only exists on the machine it was written on.

**Where that source is not — searched 2026-10-15, so the sentence above is falsifiable rather than an
assumption.** A gitignored file can still be committed, and a fork mirrors branches, so the author's whole
public output was checked before deciding to write the bridge:

| Where | Result |
|---|---|
| `mindflowgo/brAInstorm` (upstream) | one branch (`main` at `2759cb5f`), four commits, zero releases; exactly **five `.rs` files, all under `client/tauri/src-tauri/`** — none in `crates/` |
| `mindflowgo/brAInstorm.old` | a **fork of `Zen4-bit/Proxima`** (2026-06-11) — the origin the `PROXIMA_*` fallbacks in `skills/skill-prompts.cjs` point at; zero Rust entries, zero `crates/` |
| the author's other repositories (100 total) | only two are Rust (`breaktime`, `mac_thermal_monitor`), both unrelated; **no repository matches `build-sidecar`, `externalBin`, `-mcp` or `MCP bridge` except brAInstorm itself** |
| `ilc-study-tool`'s `scripts/sidecar-e2e.ts` | the only sibling with anything sidecar-shaped, and it is a **Bun server** (`server/index.ts`) — a different meaning of the word, not a Rust bridge |
| public gists | two, neither a Rust source |
| GitHub code search, whole account | `"MCP bridge"`, `jsonrpc language:rust`, `stdio mcp language:rust` and `-mcp` all return empty; the only hit for the bridge is the *comment describing it* in `build-sidecar.ts:5` |

**What that settles.** The file was never published in any form — the author compiled it locally from an
ignored directory, which is exactly how a build can work on one machine and nowhere else. So there is
nothing to reuse and nothing to recover: a bridge written on this fork is a *first* implementation rather
than a second one, and the licence question does not arise for it. The `crates/` tree now exists on this
fork and is no longer ignored; the repository's own history records that.

One more path is referenced but has no `.gitignore` entry at all:
[`orchestrator/src/processes/supervisor.ts:28`](../../orchestrator/src/processes/supervisor.ts)
probes `sandbox_api` beside `api_sandbox`, and neither is present.

Present, contrary to a reading of the same list: `client/tauri/src-tauri/icons/` **does** exist (19 files,
generic `32x32.png` / `icon.icns` names, untouched by the rename), and `client/tauri/src-tauri/` also holds
`capabilities/default.json` and `gen/`.

## 4. The rename footprint as applied

The rename is mechanical and complete — the diff is 138 insertions against 138 deletions, i.e. no line was
added without one being removed. What matters is that the identifiers fall into **classes**, and two of the
classes are *pairs* that break silently when only one half is renamed.

### 4.1 The classes of identifier

| Class | Where it now reads | Note |
|---|---|---|
| npm package names | [`package.json:2`](../../package.json) `conclave-workspace`, [`orchestrator/package.json:2`](../../orchestrator/package.json) `conclave-orchestrator`, [`client/web/package.json:2`](../../client/web/package.json) `conclave-harness` | `client/tauri/package.json` = `tauriclient` was **left alone** |
| Tauri `identifier` | [`client/tauri/src-tauri/tauri.conf.json:5`](../../client/tauri/src-tauri/tauri.conf.json) `dev.revivalist.conclave` | was `com.brainstorm.desktop`; this is the OS-level app id |
| Tauri `productName` and window titles | [`tauri.conf.json:3`](../../client/tauri/src-tauri/tauri.conf.json) `Conclave`, `:18` `Conclave`, `:31` `Conclave Overlay` | the overlay window is a second title |
| `externalBin` | [`tauri.conf.json:54`](../../client/tauri/src-tauri/tauri.conf.json) `binaries/conclave-mcp` | **half of a silent pair** — see 4.2 |
| sidecar build targets | [`scripts/build-sidecar.ts:14`](../../scripts/build-sidecar.ts) `crates/conclave-mcp/src/main.rs`, `:35` `conclave-mcp-${triple}`, `:36` `crates/conclave-mcp/conclave-mcp` | the other half of that pair |
| Rust crate metadata | [`Cargo.toml:4`](../../client/tauri/src-tauri/Cargo.toml) `Conclave Desktop LLM Harness`, `:5` `authors = ["Conclave"]` | `name = "tauriclient"` unchanged |
| the config file | [`client/tauri/src-tauri/src/lib.rs:49`](../../client/tauri/src-tauri/src/lib.rs) and `:51` `.conclave.json` | read/written by the Rust side, *described* in TS |
| env vars (**set** in Rust) | [`orchestrator_loader.rs:46`](../../client/tauri/src-tauri/src/orchestrator_loader.rs) `CONCLAVE_ORCHESTRATOR_DIR`, `:72` `CONCLAVE_DATA_DIR` | **the writer half of the second silent pair** |
| env vars (**read** in code) | `CONCLAVE_DATA_DIR`, `CONCLAVE_PROJECT_ROOT`, `CONCLAVE_MCP_URL`, `CONCLAVE_SKILLS_DIR` | the reader half — see 4.2 |
| the database filename | [`orchestrator/src/db/index.ts:11`](../../orchestrator/src/db/index.ts) `conclave.db` | |
| MCP server identity | [`orchestrator/src/mcp/index.ts:109`](../../orchestrator/src/mcp/index.ts) `conclave-orchestrator`, [`orchestrator/src/plugins/index.ts:99`](../../orchestrator/src/plugins/index.ts) `conclave-orchestrator` | the client *and* the server announce the same name |
| MCP resource URIs | [`orchestrator/src/mcp/index.ts:182`](../../orchestrator/src/mcp/index.ts) `conclave://db/stats`, `:187` `conclave://services/status` | the scheme is part of the protocol, so both the advert and the `resources/read` branch must change together |
| `localStorage` keys | 10 distinct `conclave_*` keys across `client/web/src/` | `conclave_active_tab` and `conclave_refresh_ts` are a cross-window handshake between the main window and the overlay |
| icon assets | 14 files renamed `brainstorm-*` → `conclave-*` in `assets/` and `client/web/static/` | referenced by [`app.html:7`](../../client/web/src/app.html) and the sidebar |
| app identity constants | [`skills/skill-prompts.cjs:5`](../../skills/skill-prompts.cjs) `APP_NAME = 'Conclave'`, `:6` `APP_SLUG = 'conclave'` | `:7` `LEGACY_APP_DATA_DIRS = ['proxima']` was deliberately **kept** |
| MCP client block in the settings UI | ``client/web/src/routes/(desktop)/settings/+page.svelte:35`` — `PROD_MCP_BIN = '/Applications/Conclave.app/Contents/MacOS/conclave-mcp'`, with the `conclave:` server key at `:48` | the string a user pastes into another editor's MCP config. Cited as code rather than a link because the `(desktop)` route group's parentheses cannot sit inside a markdown link target |

Two identifiers a rename could have caught were deliberately left: `client/tauri/package.json:2` and
`Cargo.toml:2` still read `tauriclient`, and `skills/brainstorm.md` keeps its filename (its body is
unrelated — it is the prompt for brainstorming, not a namesake).

### 4.2 The two pairs that break silently

**Pair one — `externalBin` ↔ `build-sidecar.ts`.** Tauri resolves an `externalBin` entry of
`binaries/conclave-mcp` by looking for `binaries/conclave-mcp-<target-triple>` next to the crate. That
filename is produced by `scripts/build-sidecar.ts`, from `mcpOutfile` at
[`:35`](../../scripts/build-sidecar.ts) and `localMcpBin` at
[`:36`](../../scripts/build-sidecar.ts) — and *both* derive from the
`crates/conclave-mcp` directory joined at [`:14`](../../scripts/build-sidecar.ts).
Rename `tauri.conf.json:54` alone and the bundle step fails loudly at build. Rename the *crate directory*
alone and the failure is silent: the copy to `localMcpBin` is wrapped in `try { … } catch {}`, so a missing
`crates/conclave-mcp/conclave-mcp` is swallowed, and because `crates/` is gitignored (Section 3) a clone
never had it to begin with.

**Pair two — the env var written in Rust and read in TypeScript.** `CONCLAVE_DATA_DIR` is **set** at
[`orchestrator_loader.rs:72`](../../client/tauri/src-tauri/src/orchestrator_loader.rs)
and **read** at `orchestrator/src/db/index.ts:10`, `orchestrator/src/bootstrap/index.ts:27`,
`orchestrator/src/index.ts:266-267` and `orchestrator/src/processes/supervisor.ts:22,25`.
`CONCLAVE_ORCHESTRATOR_DIR` is set by the user/loader and read at `orchestrator_loader.rs:46`. Every read
has a fallback, so a half-rename does not throw — it silently changes *where the app puts its state*:
`db/index.ts:10` falls back to `join(import.meta.dir, '../../data')`, i.e. inside the source tree, instead
of the OS app-data directory, and `supervisor.ts:26` falls back to probing for a sandbox beside the bundle.
The symptom is an app that boots cleanly, writes to the wrong place, and disagrees with itself between dev
and production. The same shape applies to `CONCLAVE_ORCHESTRATOR_DIR`: a miss makes
`find_orchestrator_dir()` return `None`, and
[`orchestrator_loader.rs:113`](../../client/tauri/src-tauri/src/orchestrator_loader.rs)
then prints one line and **continues without the orchestrator** rather than failing.

**A correction to the brief this page was written from.** The rename was described as env vars "read
across nine TypeScript files". Re-measured, the readers are **seven code files**: five under
`orchestrator/src/` (`index.ts`, `bootstrap/index.ts`, `db/index.ts`, `mcp/index.ts`,
`processes/supervisor.ts`), `orchestrator/bin/mcp-server.js`, and `skills/skill-prompts.cjs` (which is
CommonJS). Two more are the Rust writer above and `ARCHITECTURE.md:635`, which is documentation. The full
set of names is five: `CONCLAVE_DATA_DIR`, `CONCLAVE_ORCHESTRATOR_DIR`, `CONCLAVE_MCP_URL`,
`CONCLAVE_PROJECT_ROOT`, `CONCLAVE_SKILLS_DIR`.

**A dangling reader.** `CONCLAVE_PROJECT_ROOT` is read at
[`orchestrator/src/mcp/index.ts:37`](../../orchestrator/src/mcp/index.ts)
and described at [`ARCHITECTURE.md:635`](../../ARCHITECTURE.md), but
**nothing in the tree sets it** — there is no writer for it anywhere, so the MCP server's confined root
always falls through to `process.cwd()`. Renaming it has no effect either way; it is a dead knob.

## 5. The DanyAPI coupling, and where the tree diverges from upstream

The one external service the tree is coupled to is **DanyAPI**, an OpenAI-compatible local LLM API in a
Docker container. The coupling is a **fork image**, and the tree's expectations match that fork rather than
today's upstream.

**What the tree expects** (all verified in the renamed working tree):

- the image `ghcr.io/mindflowgo/danyapi:latest` — stated three times in
  [`ARCHITECTURE.md`](../../ARCHITECTURE.md) at `:72` (the container box),
  `:121` (the compose file) and `:651` (the port table), and cloned at bootstrap from
  `https://github.com/mindflowgo/DanyAPI.git` ([`orchestrator/src/bootstrap/index.ts:46`](../../orchestrator/src/bootstrap/index.ts));
- **port 8000**, OpenAI-compatible — [`orchestrator/plugins/danyapi/plugin.json:7`](../../orchestrator/plugins/danyapi/plugin.json),
  base URL `http://127.0.0.1:8000/v1` at
  [`orchestrator/src/providers/danyapi.ts:23`](../../orchestrator/src/providers/danyapi.ts);
- `POST /v1/chat/completions` with **`session_id` bound to the tab id**, streaming SSE with a usage chunk —
  [`ARCHITECTURE.md:274`](../../ARCHITECTURE.md) and `:287`, sent by
  [`danyapi.ts:110`](../../orchestrator/src/providers/danyapi.ts);
- **`POST /v1/files`** for attachment staging, keyed by the same `session_id` —
  [`ARCHITECTURE.md:66`](../../ARCHITECTURE.md), `:308` and `:333`, called
  from [`orchestrator/src/index.ts:293`](../../orchestrator/src/index.ts)
  (with a 404 fallback at `:302`) and from
  [`DanyApiProvider.uploadFile()` at `danyapi.ts:45`](../../orchestrator/src/providers/danyapi.ts).

**Where it diverges.** The image the tree names and the source that image is built from are the **fork**,
not the upstream:

- `mindflowgo/DanyAPI` is a GitHub **fork** whose `parent`/`source` is `FANATFANATA/DanyAPI` (verified via
  `gh api repos/mindflowgo/DanyAPI`). Its tip is `e551331`, "Merge upstream/main into main", 2026-09-07 —
  which is exactly the `sha-e551331` tag on `ghcr.io/mindflowgo/danyapi`, alongside `latest` (verified:
  the image is a public OCI index). **That fork does have the route** — `POST /v1/files` at
  `danyapi/api/openai.py:1157`, plus `GET /v1/files/{file_id}` at `:1292` and a `/v1/sessions` family at
  `:1331`/`:1386`/`:1446`. So the tree's `/v1/files` and `session_id` coupling is **consistent with the
  image it names**, and the coupling is to the fork by design.
- The **upstream** the fork came from is not reachable any more at its recorded path:
  `gh api repos/FANATFANATA/DanyAPI` and `https://github.com/FANATFANATA/DanyAPI` both return **404**, and
  `docker manifest inspect ghcr.io/fanatfanata/danyapi:latest` answers **`denied`**.
- The snapshot of that upstream on this machine, at
  [`.agent-resources/DanyAPI-prod/`](../../../../.agent-resources/DanyAPI-prod/), **has no `/v1/files` route
  at all**: its README's endpoint list omits it, and `rg "v1/files"` over the whole tree exits 1 with no
  match. Its route inventory is `POST /v1/chat/completions` (`danyapi/api/chats.py:85`), `/v1/completions`,
  `/v1/embeddings`, `/v1/moderations`, the `/v1/responses` family, `/v1/messages`, the `/v1/images`
  family, `/v1/tokens`, `/v1/models` and `/health`.
- What upstream does instead: attachments ride as a **field on the chat request**, not a staging route —
  `files: list[FileSpec] | None = None` at
  [`danyapi/api/schemas.py:65`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/schemas.py), where
  `FileSpec` is `name` + `content` + `content_type` (`:47-50`) and the content is a base64 data URI
  (the decoder is in `danyapi/api/attachments.py`, which imports `base64` and caps a request at 50 files /
  10 MB).

**So the mismatch is a version skew, not a typo.** Point the tree at a current upstream image and
`DanyApiProvider.uploadFile()` breaks: `POST http://127.0.0.1:8000/v1/files` returns 404, and the
attachment has to be re-expressed as a `files[]` entry on the completions request. Keep it on
`ghcr.io/mindflowgo/danyapi` and it works — but that image is a fork frozen at 2026-09-07 whose upstream
has since refactored its API surface past it, so the image will not receive upstream fixes without a
rebase. `ARCHITECTURE.md:367` anticipates exactly this by noting that the model name is lowercased before
being sent to "completions and file staging endpoints (`POST /v1/files`)".

Two smaller notes on the same coupling. The provider's model list is hard-coded
([`danyapi.ts:4-11`](../../orchestrator/src/providers/danyapi.ts): six
ids including `qwen3.7-plus`), while the upstream snapshot's own default model string is
`deepseek-v4.1-flash` (`schemas.py:54`) — neither is validated against the container. And `danyapi` is
registered as a **built-in plugin** with its own MCP scaffold
([`orchestrator/plugins/danyapi/mcp.js`](../../orchestrator/plugins/danyapi/mcp.js)
implementing `ask_deepseek` / `ask_qwen` / `ask_zai`), so the container's availability gates three
MCP tools, not just the chat path.

## 6. State at read time — the tree was moving

Everything above was read on **2026-10-15**. At the first read the working tree carried an **uncommitted
dependency upgrade** — every dependency the audit found behind, raised to latest, with `lucide-svelte`
swapped for `@lucide/svelte` and `tokio-tungstenite` moved `0.24 → 0.30`. That upgrade was then
committed as **`d4f3235`** (*Upgrade every dependency to its latest published version*, 2026-10-15
10:13), so `main`, `origin/main` and `HEAD` are all at `d4f3235` as this is written, and the working
tree is clean.

The consequence for a reader: the rename footprint in Section 4 is `git show --stat 1dd4aec`, which is
stable, but any count that named the working tree was a timestamped observation. `d4f3235` also touched
things beyond the manifests — it added `client/web/src/env.ts`, deleted `client/web/svelte.config.js`,
and changed `vite.config.ts` and `tsconfig.json`, which is the code half of the Vite 6→8 move. The
dependency audit's own page carries the upgrade's after-state; the last re-measure of the *code* changes
Vite 8 forces is still outstanding.

## Related

- [Project documentation map](./index.md) — the map this page hangs from
- [Conclave dependency audit](./conclave-dependency-audit.md) — every declared dependency, measured
  against the live registries on the same day
- [Upstream reuse rule](../../../../.cursor/rules/30-upstream-reuse.mdc) — a fork is a rebase obligation,
  which is the DanyAPI situation in Section 5
