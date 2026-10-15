---
title: Conclave MCP layer — implementation scaffold and roadmap
topic: mcp-roadmap
updated: 2026-10-15
status: draft
---

# Conclave MCP layer — implementation scaffold and roadmap

Conclave already speaks MCP, but only just: one orchestrator class advertises four built-in tools
and two static resources, two thin stdio bridges forward to it, and nothing else in the protocol is
implemented. This page is the plan for finishing it. Every claim below was read out of the working
tree on **2026-10-15**; the protocol requirements in §2 were read from the live specification on the
same day.

Read this with:

- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — the tree, the two silent
  rename pairs, and the `crates/` omission this page assumes.
- [Conclave dependency audit](./conclave-dependency-audit.md) — the declared dependency baseline.
- [Documentation map](./index.md) — the map this page hangs from.

---

## 1. What exists today

### 1.1 The server

`LightweightMcpServer` is one file — [`orchestrator/src/mcp/index.ts`](../../orchestrator/src/mcp/index.ts)
(390 lines). It is a hand-written JSON-RPC dispatcher over a `switch`, with no SDK and no dependency.
It is constructed as a module singleton at
[`index.ts:390`](../../orchestrator/src/mcp/index.ts) and reached two ways:

- **HTTP**: `POST http://127.0.0.1:4000/mcp` — handled at
  [`orchestrator/src/index.ts:131`](../../orchestrator/src/index.ts), calling
  `mcpServer.handleJsonRpc(body)` at [`:135`](../../orchestrator/src/index.ts). A `null` reply
  becomes `204 No Content` ([`:136`](../../orchestrator/src/index.ts)); a JSON parse failure becomes
  `400` with a body that has **no `id`** ([`:147`](../../orchestrator/src/index.ts)). `GET /mcp`
  returns `{"status":"MCP Endpoint Ready"}` — not an MCP message. The bind address is printed at
  [`index.ts:664`](../../orchestrator/src/index.ts).
- **WebSocket**: `ws://127.0.0.1:4000/ws`, envelope type `MCP_REQUEST`, at
  [`orchestrator/src/index.ts:571`](../../orchestrator/src/index.ts) — the in-app path, and the only
  path the SvelteKit UI uses.

The confined root is `process.env.CONCLAVE_PROJECT_ROOT || process.cwd()`
([`mcp/index.ts:37`](../../orchestrator/src/mcp/index.ts)). **`CONCLAVE_PROJECT_ROOT` has no writer
anywhere in the tree** — it is a dead knob, so the root is always the orchestrator's CWD.

### 1.2 The four advertised tools

Registered in `registerBuiltinTools()` and keyed into a `Map`. All four return a result whose only
block is `text` (`content: [{ type: 'text', text }]`); there is no `structuredContent`, no
`outputSchema`, and no `resultType`.

| Tool | Registered at | What it does | Mutating |
|---|---|---|---|
| `run_command` | [`mcp/index.ts:42`](../../orchestrator/src/mcp/index.ts) | `spawnSync('sh', ['-c', cmd])` with `cwd` clamped under the root, 30 s timeout, 10 MiB buffer ([`:265`](../../orchestrator/src/mcp/index.ts)); non-zero exit sets `isError: true` | yes |
| `read_file` | [`mcp/index.ts:55`](../../orchestrator/src/mcp/index.ts) | `readFileSync(resolve(rootDir, path), 'utf-8')`, refused under a `startsWith(rootDir)` check ([`:298`](../../orchestrator/src/mcp/index.ts)) | no |
| `write_file` | [`mcp/index.ts:67`](../../orchestrator/src/mcp/index.ts) | `writeFileSync(resolve(rootDir, path), content)` under the same check ([`:344`](../../orchestrator/src/mcp/index.ts)); does **not** create parent directories | yes |
| `get_service_status` | [`mcp/index.ts:80`](../../orchestrator/src/mcp/index.ts) | `JSON.stringify(supervisor.getStatus())` — the DanyAPI/Docker record ([`:364`](../../orchestrator/src/mcp/index.ts)) | no |

`tools/list` returns those four **plus** every plugin tool
([`mcp/index.ts:127`](../../orchestrator/src/mcp/index.ts)): `pluginManager.listMcpTools()` is
concatenated in. With the shipped DanyAPI plugin enabled that is six tools total — which is where the
settings UI's hard-coded "6 tools" badge comes from (``client/web/src/routes/(desktop)/settings/+page.svelte``).
The badge is a literal, not a query, so it drifts the moment the surface changes.

**Three defects in the built-in tools, before any protocol work:**

1. **`run_command` is not portable.** `spawnSync('sh', ['-c', cmd])` needs a POSIX `sh`; on Windows
   (this workspace) it throws unless a Git-Bash-style `sh` happens to be on `PATH`, and the throw is
   caught and returned as `isError: true` with the ENOENT text — a wrong answer that reads like a
   command failure.
2. **The path confinement is a prefix check, not a boundary check.** `filePath.startsWith(this.rootDir)`
   is satisfied by a sibling whose name *extends* the root (`/srv/root-evil` passes when the root is
   `/srv/root`). `resolve()` normalises `..`, so traversal is handled, but the sibling case is not.
3. **`write_file` cannot create a file in a new directory** — `writeFileSync` fails with ENOENT and
   that surfaces as the generic catch at [`mcp/index.ts:376`](../../orchestrator/src/mcp/index.ts).

### 1.3 The two stdio bridges

Neither bridge implements a single protocol method. Each reads newline-delimited JSON-RPC from
`stdin`, POSTs the message verbatim to the orchestrator, and writes the orchestrator's reply to
`stdout`. The entire method surface is the orchestrator's.

| | JS bridge | Rust bridge |
|---|---|---|
| File | [`orchestrator/bin/mcp-server.js`](../../orchestrator/bin/mcp-server.js) (85 lines) | [`crates/conclave-mcp/src/main.rs`](../../crates/conclave-mcp/src/main.rs) (584 lines) |
| Runner | Node ≥ 18 / Bun (`fetch`, `readline`) | `rustc -O`, stdlib only — no runtime, no async, no TLS |
| Endpoint | `CONCLAVE_MCP_URL` or `http://127.0.0.1:4000/mcp` ([`:14`](../../orchestrator/bin/mcp-server.js)) | same ([`:17`](../../crates/conclave-mcp/src/main.rs), read at [`:20`](../../crates/conclave-mcp/src/main.rs)) |
| Transport to orchestrator | `fetch` POST ([`:42`](../../orchestrator/bin/mcp-server.js)) | hand-rolled HTTP/1.1 over `TcpStream`, `Connection: close` ([`:188`](../../crates/conclave-mcp/src/main.rs)) |
| Chunked responses | handled by `fetch` → `res.json()` | hand-decoded, `decode_chunked` ([`:283`](../../crates/conclave-mcp/src/main.rs)) |
| Notifications | returns early, no reply ([`:51`](../../orchestrator/bin/mcp-server.js)) | returns on `Absent`/`Null` id ([`:54`](../../crates/conclave-mcp/src/main.rs)) |
| Failure on the wire | JSON-RPC error object, always ([`:56`](../../orchestrator/bin/mcp-server.js), `:69`) | `write_error` funnels every path ([`:121`](../../crates/conclave-mcp/src/main.rs)) |
| Bad `CONCLAVE_MCP_URL` | not guarded — fetch throws, the generic catch answers | warns on stderr, falls back to the default ([`:20`](../../crates/conclave-mcp/src/main.rs)) |
| Diagnostics | none to stderr | `[conclave-mcp] …` on stderr |
| Bundled how | copied into the macOS `.app` Resources by `build-sidecar.ts` | the `externalBin` sidecar `binaries/conclave-mcp` |

Both satisfy the stdio framing rule (one JSON-RPC message per line, nothing else on `stdout`), and
both refuse to answer a failure with an empty line. Those two properties are the ones to preserve —
see §4.

### 1.4 The `conclave://` resources

`resources/list` ([`mcp/index.ts:174`](../../orchestrator/src/mcp/index.ts)) returns exactly two
static entries, and `resources/read` ([`:196`](../../orchestrator/src/mcp/index.ts)) branches on their
URIs:

| URI | Advertised at | Read at | Body |
|---|---|---|---|
| `conclave://db/stats` | [`:182`](../../orchestrator/src/mcp/index.ts) | [`:199`](../../orchestrator/src/mcp/index.ts) | `{ totalConversations: tabs.length }` — the only field |
| `conclave://services/status` | [`:187`](../../orchestrator/src/mcp/index.ts) | [`:215`](../../orchestrator/src/mcp/index.ts) | the `supervisor.getStatus()` array |

An unknown URI returns `-32602` with `data`-less message
([`:233`](../../orchestrator/src/mcp/index.ts)) — which is the current-spec code for "not found", and
`contents` is never returned empty. Those two behaviours are already correct and should survive the
rewrite.

### 1.5 `serverInfo`

`initialize` ([`mcp/index.ts:101`](../../orchestrator/src/mcp/index.ts)) replies with:

- `protocolVersion`: whatever the client requested, defaulted to `'2024-11-05'`
  ([`:102`](../../orchestrator/src/mcp/index.ts)) — echoed, **not negotiated**;
- `serverInfo`: `{ name: 'conclave-orchestrator', version: '0.1.0' }`
  ([`:108`](../../orchestrator/src/mcp/index.ts));
- `capabilities`: `{ tools: {}, resources: {}, prompts: {} }`
  ([`:112`](../../orchestrator/src/mcp/index.ts)).

The same name and version are the client identity the plugin manager presents when it dials an MCP
plugin ([`orchestrator/src/plugins/index.ts`](../../orchestrator/src/plugins/index.ts), in
`McpStdioClient.start`), so the orchestrator is both a server and a client announcing
`conclave-orchestrator 0.1.0`.

### 1.6 The gap — methods handled vs everything else

Handled by the `switch` in `handleJsonRpc`:

| Method | Line | Behaviour |
|---|---|---|
| `initialize` | [`:101`](../../orchestrator/src/mcp/index.ts) | legacy handshake; echoes the requested version |
| `notifications/initialized` | [`:96`](../../orchestrator/src/mcp/index.ts) | swallowed, no reply |
| `notifications/cancelled` | [`:97`](../../orchestrator/src/mcp/index.ts) | swallowed — it cancels nothing |
| `tools/list` | [`:121`](../../orchestrator/src/mcp/index.ts) | builtins + plugin tools; `cursor` ignored |
| `tools/call` | [`:132`](../../orchestrator/src/mcp/index.ts) | builtin/plugin routing; `-32602` if `name` is bad |
| `resources/list` | [`:174`](../../orchestrator/src/mcp/index.ts) | the two static URIs |
| `resources/read` | [`:196`](../../orchestrator/src/mcp/index.ts) | the two branches; `-32602` otherwise |

**Everything else falls through to `default:` and returns `-32601 Method not found`**
([`mcp/index.ts:242`](../../orchestrator/src/mcp/index.ts)). The methods that therefore do not exist:

| Missing method | Category | Note |
|---|---|---|
| `server/discover` | lifecycle | mandatory in the current spec; this is the stdio era probe |
| `ping` | utility | keepalive |
| `prompts/list`, `prompts/get` | prompts | advertised via `capabilities.prompts` but **not implemented** |
| `resources/templates/list` | resources | parameterised resources |
| `resources/subscribe`, `subscriptions/listen` | resources/patterns | change streams |
| `notifications/progress` | utility | never emitted; no progress token is read |
| `notifications/message` | logging | deprecated in the current spec — do not add |
| `completion/complete` | utility | argument completion |
| `notifications/tools/list_changed`, `notifications/resources/list_changed`, `notifications/prompts/list_changed` | notifications | never emitted; plugins change the tool list at runtime |
| `roots/list`, `sampling/createMessage`, `elicitation/create` | client features | `elicitation/create` is inbound-to-client and irrelevant to a server; **`roots` and `sampling` are also deprecated in `2026-07-28`** (SEP-2577) — do not add them either |
| `logging/setLevel` | logging | deprecated (SEP-2577) — log to stderr on stdio instead |

**And a mis-advertisement dead centre of the handshake.** The server advertises a `prompts`
capability it cannot serve, echoes a `protocolVersion` it does not implement, and has no
`resultType` on any result. Asked for `2026-07-28`, it will answer `initialize` with
`protocolVersion: "2026-07-28"` and then behave as a `2025-11-25`-and-earlier server — modern
per-request `_meta` semantics are not read anywhere. A client that believes the echo will send
modern requests and be silently mis-served.

---

## 2. What MCP requires — the checklist

**Specification read: MCP revision `2026-07-28`, which the specification page at
`modelcontextprotocol.io/specification/versioning` names as the current version on 2026-10-15.**
Revisions are dated `YYYY-MM-DD`; `2026-07-28` is "current", earlier revisions are "final". The
protocol model changed at this revision: it is **stateless**, with version, client identity and
capabilities carried **per request** in `_meta`, and the `initialize` handshake demoted to a
**legacy** mechanism (`2025-11-25` and earlier). Sources, all fetched 2026-10-15:

- base protocol, statelessness, `_meta`, error codes — `/specification/2026-07-28/basic`
- version negotiation and the era matrix — `/specification/2026-07-28/basic/versioning`
- discovery — `/specification/2026-07-28/server/discover`
- tools — `/specification/2026-07-28/server/tools`
- resources — `/specification/2026-07-28/server/resources`
- prompts — `/specification/2026-07-28/server/prompts`
- stdio binding — `/specification/2026-07-28/basic/transports/stdio`
- progress — `/specification/2026-07-28/basic/patterns/progress`
- cancellation — `/specification/2026-07-28/basic/patterns/cancellation`
- logging (deprecated) — `/specification/2026-07-28/server/utilities/logging`

> **Independently re-verified 2026-10-15**, reading the shipping pages rather than the summary above.
> The version selector on every page reads **"Version 2026-07-28 (latest)"**, so the revision is right.
> Two things this check added, both from `/specification/2026-07-28/changelog` and `…/deprecated`:
> - **`Roots`, `Sampling` and `Logging` are deprecated under SEP-2577**, with removal no earlier than
>   2027-07-28 — the same window as every other entry in that registry. The table above already said
>   "do not add" for the two logging methods; the correction is that `roots` and `sampling` are in the
>   same state, so a client-facing feature being "missing" is the *right* answer for them, not a gap.
> - **Protocol-level sessions and the `Mcp-Session-Id` header are removed at this revision** (SEP-2567).
>   That is worth its own line because this project is built around sessions — a tab id rides the
>   provider's `session_id` — so "the protocol removed sessions" is a design input, not a footnote.

### 2.1 Decision first: which era

A server may be **modern** (per-request `_meta`), **legacy** (`initialize` handshake), or
**dual-era**, serving both on the same endpoint. The tree is legacy-only today. Pick one before
writing code, because it changes every handler signature:

- [ ] **Decide legacy-only, modern-only, or dual-era.** A dual-era server selects semantics from how
      the client opens; it may serve both eras concurrently on one endpoint.
- [ ] If modern, implement `server/discover` — **mandatory** — returning `supportedVersions`,
      `capabilities`, and `io.modelcontextprotocol/serverInfo` inside `_meta`.
- [ ] If modern, read `_meta.io.modelcontextprotocol/protocolVersion` (**required**) and
      `clientCapabilities` (**required**) on **every** request. A request missing a required field is
      malformed: `-32602`, and on HTTP a `400`.
- [ ] If legacy or dual-era, keep answering `initialize` and scope the session to the stdio process /
      HTTP session as the negotiated legacy revision requires.

### 2.2 Base protocol and error discipline

- [ ] Every message is JSON-RPC 2.0. Request ids are strings or integers and **MUST NOT be `null`**.
- [ ] `result` carries a `resultType`; `"complete"` for a finished operation, `"input_required"` for
      multi-round-trip. Absent `resultType` is read as `"complete"` for backwards compatibility — so
      omitting it is legacy-compatible, not modern.
- [ ] Do **not** emit codes in `-32000…-32019` for new meanings (that sub-range is legacy);
      `-32020…-32099` is spec-reserved and emits only the defined codes. `-32022` is
      `UnsupportedProtocolVersion`.
- [ ] Version mismatch answers `UnsupportedProtocolVersionError` (`-32022`) with
      `data.supported` and `data.requested`.
- [ ] `-32601` is "method not found"; `-32602` is "invalid params" — and under `2026-07-28` an
      **unknown tool name is a `-32602`**, not `-32601` (which is what
      [`mcp/index.ts:374`](../../orchestrator/src/mcp/index.ts) returns today).

### 2.3 Tools

- [ ] Declare the `tools` capability; add `listChanged: true` only if the server actually emits
      `notifications/tools/list_changed` (the orchestrator can, because plugins load at runtime).
- [ ] `tools/list`: each tool has `name` (1–128 chars, `[A-Za-z0-9_.-]`), `description`, and an
      `inputSchema` that is a **valid JSON Schema object, never `null`**.
- [ ] `inputSchema` default dialect is **2020-12**; a parameterless tool should declare
      `{"type":"object","additionalProperties":false}`.
- [ ] Return tools in a **deterministic order** (the current concatenation of a `Map` plus a live
      plugin scan is not guaranteed stable).
- [ ] `tools/call` success: `content` as an array of blocks (`text` at minimum), plus optional
      `structuredContent` conforming to `outputSchema`.
- [ ] `tools/call` **tool execution error**: a normal result with `isError: true` — this is the shape
      the current four tools already produce, and the shape that lets a model self-correct.
- [ ] Unknown tool or malformed call: a JSON-RPC **protocol error** (`-32602`), not an `isError`
      result.
- [ ] Validate every argument before executing.

### 2.4 Resources

- [ ] Declare the `resources` capability; `listChanged`/`subscribe` are optional and advertised
      independently.
- [ ] `resources/list` and `resources/read` must both be answered; `contents` may hold several
      entries for one `read`.
- [ ] A missing resource **MUST** be `-32602` and `contents` **MUST NOT** be returned empty. The
      current `conclave://` handling already does this.
- [ ] `resources/templates/list` for the parameterised resources (a `conclave://tabs/{id}` family
      needs one).
- [ ] `file://` serving must sanitise paths against traversal; a custom scheme must be RFC 3986 valid
      (`conclave://` is).

### 2.5 Prompts

- [ ] Declare the `prompts` capability **only if** `prompts/list` and `prompts/get` are answered.
- [ ] `prompts/list`: `name`, optional `title`, `description`, `arguments[]` (`name`, `description`,
      `required`).
- [ ] `prompts/get`: `messages[]`, each `{ role: "user" | "assistant", content: <block> }`.
- [ ] Missing prompt / missing required argument: `-32602`.

### 2.6 Utilities

- [ ] **Progress**: read `params._meta.progressToken`; if present, emit
      `notifications/progress` with a `progress` that **increases monotonically** (with optional
      `total` and `message`), and stop when the request completes.
- [ ] **Cancellation (stdio)**: a client cancels by sending `notifications/cancelled` with the
      request id; the server **SHOULD** stop the work and **MUST NOT** send anything further for
      that request. Today `notifications/cancelled` is an unconditional no-op
      ([`mcp/index.ts:97`](../../orchestrator/src/mcp/index.ts)).
- [ ] **Timeouts**: every request is bounded.
- [ ] **Logging**: `notifications/message` is **deprecated as of `2026-07-28`**. Do not implement it.
      Log to **stderr** on stdio (free-form, allowed), or OpenTelemetry for structure.

### 2.7 Transport

- [ ] stdio: one JSON-RPC message per line on `stdin`/`stdout`, **no embedded newlines**; `stdout`
      carries **only** MCP messages; `stderr` is for logs and a client must not read it as errors.
- [ ] Servers **MUST NOT** write JSON-RPC *requests* to `stdout`; server-initiated interaction rides
      an `InputRequiredResult` reply.
- [ ] The client's era probe on stdio is `server/discover`; a legacy server answers with
      `-32601`/`-32602`-style errors or not at all, and the client then falls back to `initialize`.
      The current server is exactly that legacy answer — so it works today *by falling back*, and
      will keep working until a client drops legacy support.

---

## 3. Proposed tool surface

Grouped, with a one-line purpose, a `inputSchema` sketch, and a mutating flag. The mutating flag is
the gate key for tool-approval policy (§5, Q2). **Backend** says whether the tool wraps code that
exists (`repos.*`, `supervisor.*`, `spawn`) or needs new orchestrator work.

### 3.1 Filesystem — read

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `read_file` | *(exists)* read a whole file as UTF-8 | `fs.readFileSync` | R | `{ path }` |
| `read_file_range` | read a line window, numbered, for large files | new | R | `{ path, offset?, limit? }` |
| `list_directory` | list entries with type and size | new | R | `{ path?, recursive? }` |
| `search_files` | find paths by glob/name | new | R | `{ glob, path?, limit? }` |
| `search_content` | regex search across the root with include/exclude | new (`rg`) | R | `{ pattern, path?, include?, exclude?, maxResults? }` |
| `stat_path` | existence, type, size, mtime | new | R | `{ path }` |

### 3.2 Filesystem — mutate

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `write_file` | *(exists)* write whole content to a file | `fs.writeFileSync` | M | `{ path, content }` |
| `apply_patch` | apply a unified diff or an ordered list of search→replace edits | new | M | `{ path, patch }` *or* `{ path, edits: [{ find, replace, all? }] }` |
| `create_directory` | create a directory tree | new | M | `{ path }` |
| `move_path` | rename/move a file or directory | new | M | `{ from, to }` |
| `delete_path` | remove a file or directory (**destructive**) | new | M | `{ path, recursive? }` |

### 3.3 Shell

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `run_command` | *(exists)* run a command, buffered, return stdout/stderr | `spawnSync` | M | `{ command, cwd? }` |
| `run_command_stream` | start a long-running command and stream output as progress | new | M | `{ command, cwd?, shell? }` |

### 3.4 Processes and services

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `get_service_status` | *(exists)* running status + ports of managed services | `supervisor.getStatus` | R | `{}` |
| `start_service` | start a managed Docker service | `supervisor.startService` | M | `{ name }` |
| `stop_service` | stop a managed service | new (supervisor has no stop-one) | M | `{ name }` |
| `restart_service` | stop then start a managed service | new | M | `{ name }` |
| `get_service_logs` | recent log lines for a service | new | R | `{ name, tail? }` |

### 3.5 Database and state

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `list_projects` | projects with their ids and paths | `repos.getProjects` | R | `{}` |
| `list_tabs` | tabs, optionally filtered by project | `repos.getAllTabs` / `getProjectTabs` | R | `{ projectId? }` |
| `get_tab_messages` | a tab's message history | `repos.getTabMessages` | R | `{ tabId, days? }` |
| `get_settings` | settings map, secrets redacted | `repos.getSettings` | R | `{}` |
| `set_setting` | write one setting | `repos.setSetting` | M | `{ key, value }` |

### 3.6 Session and tab management

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `create_tab` | create a conversation tab under a project | `repos.createTab` | M | `{ projectId, name? }` |
| `rename_tab` | rename a tab | `repos.renameTab` | M | `{ tabId, name }` |
| `archive_tab` | archive/unarchive a tab | `repos.setTabArchived` | M | `{ tabId, archived }` |
| `delete_tab` | delete a tab (**destructive**) | `repos.deleteTab` | M | `{ tabId }` |
| `get_session_state` | the tab → model → settings snapshot a client needs to resume | new (needs an explicit id; the protocol is stateless) | R | `{ tabId? }` |
| `send_prompt` | post a user message into a tab and run the model, persisting both turns | `llmRouter.streamChat` | M | `{ tabId, message, provider?, model?, attachments? }` |

### 3.7 Provider and model invocation

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `list_models` | the models the enabled plugins/providers offer | `getAllAvailableModels` | R | `{}` |
| `invoke_model` | one-shot completion to a named provider/model, no tab side effects | `getProvider` + adapter | M | `{ prompt, provider?, model?, temperature?, maxTokens? }` |

`invoke_model` generalises the three scaffold tools the DanyAPI plugin ships
(`ask_deepseek`/`ask_qwen`, declared in
[`orchestrator/plugins/danyapi/plugin.json`](../../orchestrator/plugins/danyapi/plugin.json), plus an
`ask_zai` branch the scaffold handles but never advertises — see
[`orchestrator/plugins/danyapi/mcp.js`](../../orchestrator/plugins/danyapi/mcp.js)).

### 3.8 Skills

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `list_skills` | the skill registry: name, file, variables | [`skills/skill-prompts.cjs`](../../skills/skill-prompts.cjs) `listSkills` | R | `{}` |
| `get_skill` | one skill's template and variables | `getSkill` | R | `{ name }` |
| `run_skill` | render a skill with variables and dispatch it to a model in a tab | `renderSkillPrompt` + `send_prompt` | M | `{ name, variables, tabId?, provider?, model? }` |

The registry is CommonJS and resolves its directory from `CONCLAVE_SKILLS_DIR`, falling back to the
bundled `skills/` next to the orchestrator; there is no MCP path to it today.

### 3.9 Plugins

| Tool | Purpose | Backend | R/M | `inputSchema` sketch |
|---|---|---|---|---|
| `list_plugins` | installed plugins, their status and tools | `pluginManager.list` | R | `{}` |
| `install_plugin` | install a plugin from a git URL | `pluginManager.installFromGit` | M | `{ url }` |
| `toggle_plugin` | enable/disable a plugin | `pluginManager.toggle` | M | `{ id, enabled }` |
| `remove_plugin` | remove a plugin and its directory (**destructive**) | `pluginManager.remove` | M | `{ id }` |

**Counts.** Four tools exist. **34 are proposed** — 15 read-only and 19 mutating. With the existing
four the target surface is **38 tools**, and `read_file`, `write_file`, `run_command` and
`get_service_status` are extended in place rather than re-added.

---

## 4. Implementation checklist

Ordered so each item is provable before the next depends on it. Every item names the smallest test
that proves it. Items 1–7 are the protocol core; 8–10 are the defects in §1.2; 11–15 are surface
work; 16 is the bundle.

1. **Pin the era and version.** Write the chosen era (`legacy`, `modern`, `dual-era`) and version
   into this page, then code to it.
   *Test:* `echo '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}' | node orchestrator/bin/mcp-server.js`
   — a `DiscoverResult` means modern; `-32601` means legacy. Record which you got.
2. **Implement `server/discover`** in `LightweightMcpServer` (a new `case` before `default:`).
   *Test:* the call above returns `supportedVersions`, `capabilities` and
   `_meta["io.modelcontextprotocol/serverInfo"]`.
3. **Validate per-request `_meta`** if modern or dual-era: require `protocolVersion` and
   `clientCapabilities`; reject with `-32602` (HTTP `400`).
   *Test:* the same message with `_meta` removed is rejected with `-32602`.
4. **Make the capability advert true.** Stop advertising `prompts` (and drop `listChanged` where it
   is not emitted) until each feature is implemented
   ([`mcp/index.ts:112`](../../orchestrator/src/mcp/index.ts)).
   *Test:* `capabilities` from item 2 lists only features whose `*/list` answers.
5. **Add `resultType: "complete"`** to every result once modern.
   *Test:* `tools/list` response contains `"resultType":"complete"`.
6. **Error-code audit.** Unknown tool → `-32602`; unknown method → `-32601`; unknown resource →
   `-32602`; no new `-32000…-32019` codes.
   *Test:* `tools/call` with `name: "no_such_tool"` returns `-32602` (today it is
   [`mcp/index.ts:374`](../../orchestrator/src/mcp/index.ts)'s `-32601`).
7. **`inputSchema` audit.** Every tool's schema is a valid JSON Schema object; parameterless tools
   use `{"type":"object","additionalProperties":false}` (today `get_service_status` sends
   `properties: {}` with no `additionalProperties`).
   *Test:* validate the whole `tools/list` output against the `2026-07-28` JSON Schema.
8. **Fix the path boundary.** Replace `startsWith(rootDir)` with a check that requires the root
   separator (or `path.relative` not escaping).
   *Test:* with the root at `<tmp>/root`, `read_file` of `<tmp>/root-evil/x` is denied.
9. **Make `run_command` portable.** On Windows use `pwsh -NoProfile -Command`; keep `sh -c`
   elsewhere. *Test:* on Windows, `run_command` of `Get-Location` succeeds.
10. **Create parent directories in `write_file`.**
    *Test:* `write_file` into a two-level-new path succeeds and the file reads back.
11. **Resources: add `resources/templates/list`** and a `conclave://tabs/{id}` family; keep the
    `-32602`-and-never-empty behaviour of §1.4.
    *Test:* `resources/read` of `conclave://tabs/nope` returns `-32602`; of a real id returns one
    non-empty `contents` entry.
12. **Prompts from the skill registry.** Implement `prompts/list` and `prompts/get` over
    [`skills/skill-prompts.cjs`](../../skills/skill-prompts.cjs).
    *Test:* `prompts/list` returns the seven bundled skills; `prompts/get` of `code_review` with a
    `code` argument renders the template.
13. **Progress and cancellation.** Honour `params._meta.progressToken` for `run_command_stream`;
    consume `notifications/cancelled` by id instead of no-op.
    *Test:* a `run_command_stream` with a progress token emits increasing `notifications/progress`
    then completes; a `notifications/cancelled` mid-run stops it and no result follows.
14. **Bridge parity.** Port any new transport behaviour into the Rust bridge. Keep the two existing
    invariants: chunked decode, and *always answer a failure with a JSON-RPC error*.
    *Test (chunked):* point both bridges at the orchestrator and assert a large `get_tab_messages`
    reply round-trips intact. *Test (silence):* stop the orchestrator, then send one request into
    each bridge; both must print one JSON-RPC error line and exit cleanly — never an empty line.
15. **Bridge/binary naming.** No new bridge file may be added without adding its `externalBin` base
    and its `build-sidecar.ts` emitter in the same change (trap 2 below).
    *Test:* `bun run build:sidecar` then assert both
    `client/tauri/src-tauri/binaries/orchestrator-<triple>(.exe)` and
    `…/conclave-mcp-<triple>(.exe)` exist and that their base names equal the two `externalBin`
    entries at [`tauri.conf.json:54`](../../client/tauri/src-tauri/tauri.conf.json).
16. **Approval gate.** Insert the policy check at the one choke point every call already passes
    through — the `tools/call` case ([`mcp/index.ts:132`](../../orchestrator/src/mcp/index.ts)) —
    keyed on the mutating flag in §3.
    *Test:* a mutating tool with the policy set to deny returns a refusal (`isError: true`) and the
    underlying `spawnSync`/`writeFileSync` is never reached.

### The two traps this workspace has already measured

**Trap 1 — a stdio bridge must decode chunked HTTP, and must never answer a failure with silence.**
Both halves are load-bearing and both are already solved once each; keep them solved.

- *Chunked.* The orchestrator answers with `new Response(JSON.stringify(...))`
  ([`orchestrator/src/index.ts:142`](../../orchestrator/src/index.ts)), and Bun may frame the body as
  `Transfer-Encoding: chunked` with no `Content-Length` — a reader that trusts `Content-Length`
  truncates. The Rust bridge decodes it explicitly ([`main.rs:283`](../../crates/conclave-mcp/src/main.rs),
  with the trap named in a comment at [`:257`](../../crates/conclave-mcp/src/main.rs)); the JS bridge
  gets it free from `fetch`. Any new bridge must do one of the two.
- *Silence.* Every failure path — parse error, non-2xx, unparsable 2xx body, connection refused, a
  bad `CONCLAVE_MCP_URL` — must emit one well-formed JSON-RPC error line. The JS bridge funnels to
  the catch at [`:69`](../../orchestrator/bin/mcp-server.js); the Rust bridge funnels everything
  through `write_error` ([`:121`](../../crates/conclave-mcp/src/main.rs)). A bridge that hangs on a
  dead orchestrator is the failure this prevents.

**Trap 2 — `externalBin` base names must equal what `build-sidecar.ts` emits.**
[`tauri.conf.json:54`](../../client/tauri/src-tauri/tauri.conf.json) declares
`binaries/orchestrator` and `binaries/conclave-mcp`; Tauri resolves each by appending
`-<target-triple>`, and the matching filenames are produced only by
[`scripts/build-sidecar.ts`](../../scripts/build-sidecar.ts) — `orchestrator-${triple}${exeSuffix}`
and `conclave-mcp-${triple}${exeSuffix}`, with the `.exe` suffix attached on Windows because a bare
`rustc -o <name>` writes the name literally. Rename half of that pair and the bundle silently ships
without the sidecar; the two halves must change together. The dev-sync copy at
[`build-sidecar.ts:72`](../../scripts/build-sidecar.ts) now warns loudly instead of swallowing its
failure — keep it loud.

---

## 5. Open questions — questions, not decisions

Marked as questions deliberately; none of these is settled by this page.

- **Q1 — Rust bridge: replace, or coexist?** The Rust bridge is the bundled production one and needs
  no runtime; the JS bridge is read from a developer path in the settings UI and is the one a
  contributor can edit without a Rust toolchain. Should the JS bridge be retired once the Rust bridge
  reaches parity, or kept as the dev path? Coupled to Q3: the Rust bridge is stdlib-only, so any
  behaviour needing TLS or a JSON library will not fit it as written.
- **Q2 — where does tool-approval policy belong?** Candidates: the orchestrator's `tools/call` (one
  choke point, but it cannot see the user); the MCP *client* (the standard says the host should obtain
  consent and the protocol cannot enforce it); or the Tauri/Svelte layer (where the human is). The
  mutating flag in §3 is only useful if this is answered.
- **Q3 — target era?** Modern (`2026-07-28`, per-request `_meta`, stateless) is where the spec is;
  legacy keeps every deployed client working unchanged. Dual-era is the safe answer and the most
  code. Which is the goal?
- **Q4 — is the orchestrator a server, a client, or both?** It is already a client (it dials plugin
  MCP servers). Should the plugin client be upgraded to the modern era in the same change, or stay
  legacy until the server side is done?
- **Q5 — what replaces the dead `CONCLAVE_PROJECT_ROOT`?** It is read and never set. Options: set it
  from the Tauri loader (it already sets `CONCLAVE_DATA_DIR`), or make the root a per-request tool
  argument validated against a roots list.
- **Q6 — how do streaming tool outputs cross the stdio bridge?** stdio has one newline-delimited
  channel, so a long `run_command_stream` must express its output as `notifications/progress` on the
  same stream (or an `InputRequiredResult`). Confirm that shape before building it.
- **Q7 — should the HTTP `/mcp` endpoint be authenticated?** It is CORS-only and bound to
  `127.0.0.1`; the stdio binding says nothing about auth. Does loopback-only count as sufficient, or
  does the HTTP path need a token?
- **Q8 — do the `conclave://` URIs survive?** They are valid custom schemes, but `resources/templates/list`
  wants a template form; decide whether the static pair becomes a template family.
- **Q9 — does `tools/list` pagination ever matter?** The current `cursor` is ignored
  ([`mcp/index.ts:121`](../../orchestrator/src/mcp/index.ts)); with 38 tools and plugin additions, is
  paging worth implementing or is a single deterministic list enough?

---

## Related

- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — the tree this page extends,
  including the `crates/` omission and the two silent rename pairs
- [Conclave dependency audit](./conclave-dependency-audit.md) — the dependency baseline
- [Documentation map](./index.md) — the map this page hangs from
- MCP specification, revision `2026-07-28` — `https://modelcontextprotocol.io/specification/2026-07-28/`
  (base protocol, versioning, server/tools, server/resources, server/prompts, server/discover,
  server/utilities/logging, basic/transports/stdio, basic/patterns/progress,
  basic/patterns/cancellation)
