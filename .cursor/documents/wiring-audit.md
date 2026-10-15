---
title: Conclave wiring audit — cross-boundary string and identifier agreement
topic: wiring-audit
updated: 2026-10-15
status: current
---

# Conclave wiring audit — cross-boundary string and identifier agreement

This page covers one defect class: **two components that disagree about a string, a route, an identifier
or a payload shape, because each end was written on its own.** Neither end is internally wrong, so no unit
test on either side can see it. The reference instance is hardening **C1** — `deleteProviderSessions`
called `DELETE <endpoint>/session/<id>` against a provider whose route is `/sessions/` — and its signature
is that a documented feature had never run once.

**How this differs from [hardening and upgrades](./hardening-upgrades.md).** That page is a prioritised
plan, and its items are defects *inside* a component: a swallowed error, a missing cap, an unchecked
claim. Its **[K1]**–**[K4]** patterns are about failure visibility, argument handling, manifest/lockfile
pairs and moving version tags. This page is narrower and orthogonal: every item below is a *seam* between
two independently written ends, where the only way to see the defect is to read both ends and compare the
literal. C1, C5, C2, C3, F6, S8 and O5 are already closed on that page and are not repeated here; where a
finding here also corrects a claim on that page, it says so.

## 1. Method and coverage

Everything below was read out of the working tree on **2026-10-15** with `rg` at
`$env:CURSOR_RIPGREP_PATH --hidden`, plus targeted `Read`s. Nothing was executed: no container was
started, no orchestrator was booted, no `bun test` was run. Where a verdict depends on a remote surface it
is marked as a read of the recorded evidence rather than an observed response. The W1 **Fix** below was
verified afterwards by execution — a live stub endpoint and a real orchestrator boot — and that paragraph,
not this one, is the record of it.

**Nine boundary groups were walked: the seven requested, plus two more of the same shape** (the
client/web ↔ client/tauri Tauri command and event seam, and the two MCP stdio bridges ↔ `/mcp`). The
agreements table is the coverage record; a sweep that reports only hits is unfalsifiable.

## 2. Agreements checked

Everything in this table was **found agreeing**, and is listed so the coverage can be audited.

| # | Boundary | Identifier or shape checked | Both ends | Verdict |
|---|---|---|---|---|
| 1 | WS, client → server | all 14 message types: `LOAD_SETTINGS`, `TAB_FETCH`, `TAB_CREATE`, `TAB_RENAME`, `TAB_ARCHIVE`, `TAB_DELETE`, `PROJECT_CREATE`, `PROMPT_SEND`, `MCP_REQUEST`, `PLUGIN_LIST`, `PLUGIN_INSTALL`, `PLUGIN_REMOVE`, `PLUGIN_TOGGLE`, `SETTINGS_SET` | senders in `client/web/src/lib/services/orchestratorSocket.svelte.ts` and `client/web/src/lib/stores/harness.svelte.ts` against the `switch (payload.type)` in `orchestrator/src/index.ts` | every one has a `case`; the `default` arm answers `ERROR` |
| 1 | WS, server → client (payload fields) | `SETTINGS_LOADED` carries `projects`/`tabs`/`settings`/`services`/`models`/`plugins`; `TAB_DETAIL` carries `tabId`+`messages`; `TAB_CREATED` carries `tab`; `TAB_RENAMED` `tabId`+`name`; `TAB_DELETED` `tabId`; `TAB_ARCHIVED` `tabId`+`archived`; `TAB_UPDATED` `tabId`; `PLUGINS_UPDATED` `plugins`; `PLUGIN_ERROR` `error`; `CHAT_TOKEN` `tabId`+`token`; `CHAT_USAGE` `tabId`+`totalTokens`+`model`; `CHAT_ERROR` `tabId`+`error`; `CHAT_COMPLETE` `tabId`+`totalTokens`+`model`; `MCP_RESPONSE` `rpc`; `SERVER_READY` `serverVersion`/`status` | `sendWs`/`broadcastWs` payloads in `orchestrator/src/index.ts` against `handleMessage` in `orchestratorSocket.svelte.ts` and `handleOrchestratorMessage` in `client/web/src/routes/overlay/+page.svelte` | every field the client reads is present in the payload; no read of a key the server never sends |
| 1 | WS, client → server (payload fields) | `TAB_FETCH` `tabId`+`days`; `PROMPT_SEND` `tabId`/`content`/`attachments`/`provider`/`model`; `SETTINGS_SET` `key`+`value`; `PLUGIN_TOGGLE` `id`+`enabled` | `sendMessage`/`fetchTabMessages`/`setSetting` in `harness.svelte.ts` against the `payload.*` reads in `orchestrator/src/index.ts` | agree |
| 2 | HTTP, client → orchestrator | `http://127.0.0.1:4000/api/settings/load`, `.../api/projects`, `.../api/tabs`, `.../api/tabs/<id>/messages?days=<n>`, `DELETE .../api/tabs/<id>`, `POST .../api/upload` | `fetch` sites in `harness.svelte.ts` and `PromptInput.svelte` against the `url.pathname` branches in `orchestrator/src/index.ts` | every URL and method has a matching branch; the `days` query name agrees on both sides |
| 2 | multipart upload fields | `file`, `session_id`, `model` | `uploadSingleFile` in `client/web/src/lib/components/PromptInput.svelte` against `formData.getAll('file')`/`getAll('files')` and `formData.get('session_id')`/`get('chatId')`/`get('model')` in the `/api/upload` branch of `orchestrator/src/index.ts` | agree; the server also accepts `files` and `chatId` aliases |
| 3 | sidecar, env vars | `CONCLAVE_DATA_DIR` set by the Rust loader, read by five TypeScript modules | `cmd.env("CONCLAVE_DATA_DIR", &data_dir)` in `spawn_child` (`client/tauri/src-tauri/src/orchestrator_loader.rs`) against `process.env.CONCLAVE_DATA_DIR` in `db/index.ts`, `bootstrap/index.ts`, `index.ts`, `processes/supervisor.ts` | agree, and production sets it while dev leaves it unset on purpose; `CONCLAVE_PROJECT_ROOT` is read and never written, which is already recorded (features ledger item 7, hardening S5) |
| 3 | sidecar, `externalBin` | `binaries/orchestrator`, `binaries/conclave-mcp` | `bundle.externalBin` in `client/tauri/src-tauri/tauri.conf.json` against `orchestratorOutfile`/`mcpOutfile` in `scripts/build-sidecar.ts` | agree, including the Windows `.exe` suffix the script attaches |
| 3 | sidecar, spawn argument | dev runs `bun` with argv `["src/index.ts"]` in the orchestrator directory; production runs the sidecar binary with no arguments | `Command::new("bun").arg("src/index.ts")` and `Command::new(&path)` in `spawn_orchestrator` against `orchestrator/package.json` (`"start": "bun src/index.ts"`) | agree; the compiled sidecar is a `bun build --compile` of `orchestrator/src/index.ts`, so it needs no argv |
| 3 | sidecar, triple | `orchestrator-<triple>` | `cargo:rustc-env=ORCHESTRATOR_SIDECAR=orchestrator-{}` from `TARGET` in `client/tauri/src-tauri/build.rs` against `orchestrator-${triple}` from `rustc -Vv` host in `scripts/build-sidecar.ts` | agree for a native build; the cross-build case is noted in §5 and is not claimed as a defect |
| 3+ | Tauri commands | 11 invoke names: `get_window_state`, `save_window_state`, `exit_app`, `enter_overlay_mode`, `exit_overlay_mode`, `sync_overlay_bounds`, `set_window_always_on_top`, `set_overlay_size`, `ws_status`, `ws_send`, `ws_reconnect` | `tauriInvoke(...)` calls in `client/web/src/lib/services/windowManager.ts` and `orchestratorSocket.svelte.ts` against `tauri::generate_handler!` in `client/tauri/src-tauri/src/lib.rs` | all 11 registered, none dangling |
| 3+ | Tauri events | `orchestrator-message`, `orchestrator-status`, `refresh-active-thread`, `switch-tab` | Rust `app.emit(...)`/`main_win.emit(...)` sites against `listenTauriEvent(...)` sites | agree; `switch-tab` is emitted from JS (`emitTauriEvent` in the overlay page) and listened for in the desktop layout, so it is a JS-to-JS event with both ends present |
| 3+ | Tauri capability strings | `core:event:allow-emit`, `core:event:allow-listen`, `core:window:allow-*` | `client/tauri/src-tauri/capabilities/default.json` against the `__TAURI__` APIs called in `windowManager.ts` | the emitted and listened events and the window operations used are covered |
| 4 | orchestrator → DanyAPI routes | `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/files`, `DELETE /v1/sessions/<id>` | `/models`, `/chat/completions`, `/files` off the resolved base URL in `orchestrator/src/providers/danyapi.ts`; `deleteProviderSession` in `orchestrator/src/providers/sessions.ts`; the resolved URL in the `/api/upload` branch of `index.ts` | the four requested routes are the two recorded as real plus the two recorded as version skew in [DanyAPI review §3](./danyapi-review.md); no fifth route is called |
| 4 | orchestrator → DanyAPI body fields | `session_id`, `stream: true`, `stream_options.include_usage` | `requestBody` in `DanyApiProvider.streamChat`, and `{ model, messages, session_id }` in the scaffold, against the fork surface recorded in [DanyAPI review §3](./danyapi-review.md) | agree with the fork as recorded |
| 5 | plugin manifest keys | `id`, `name`, `type`, `serviceName`, `mcp.scaffold`, `mcp.tools`, `models` | `orchestrator/plugins/danyapi/plugin.json` and `BUILTIN_PLUGINS` in `orchestrator/src/plugins/builtin.ts` against every key read in `PluginManager` (`orchestrator/src/plugins/index.ts`) | every key the DanyAPI manifest declares and the orchestrator needs is read |
| 6 | database columns | `messages.error`, `tabs.archived` | `CREATE TABLE` in `orchestrator/src/db/schema.ts` and `orchestrator/src/db/schema.sql` against the two `ALTER TABLE` statements in `initDatabase()` (`orchestrator/src/db/index.ts`) | all three agree; `error` is declared in both schema copies and added by the second guarded `ALTER TABLE`, so hardening F3's claim stands |
| 6 | database columns, write vs read | every column `repos` INSERTs is one the schema declares; `msg.totalTokens` is synthesized from the parsed `usage` JSON | `addMessage` in `db/index.ts` against `getTabMessages` and `handleTabDetail` (`harness.svelte.ts`) | agree; the client's `m.totalTokens ?? m.usage?.totalTokens` is correct because `getTabMessages` lifts `usage.totalTokens` onto the row |
| 7 | cross-window localStorage | `conclave_active_tab`, `conclave_refresh_ts`, `conclave_active_model`, `conclave_last_project_dir`, `conclave_overlay_duration`, `conclave_last_load_settings`, `conclave_window_mode`, `conclave_full_bounds`, `conclave_hud_bounds`, `conclave_prompt_dims` | every `localStorage.setItem` against every `getItem` and against the `storage` listener in `client/web/src/routes/(desktop)/+layout.svelte` | every key written is read somewhere; `conclave_refresh_ts` is consumed by the `storage` listener even though no `getItem` names it |
| 7 | hardcoded Base58 fallback | `DEFAULT_TAB_ID = '1112'` | `client/web/src/routes/overlay/+page.svelte` against the seed in `initDatabase()` (`newTabId(1)` → `'1112'`) | agree with the server's own seed |
| 8 | MCP bridges → `/mcp` | `http://127.0.0.1:4000/mcp` and header `Origin: http://127.0.0.1:4000` | `DEFAULT_URL` in `crates/conclave-mcp/src/main.rs` and `ORCHESTRATOR_MCP_URL` in `orchestrator/bin/mcp-server.js` against the `/mcp` branch and `isAllowedOrigin` in `orchestrator/src/index.ts` | agree, and the explicit `Origin` is what the origin check was written for |
| 9 | SvelteKit env declaration | `$app/env/private` → `variables` in `src/env.ts` | `import { BUN_ROUTER_URL } from '$app/env/private'` in `client/web/src/routes/api/chat/+server.ts` against `defineEnvVars` from `@sveltejs/kit/env` in `client/web/src/env.ts` | agree; the module and the helper both exist in the installed Kit |

## 3. Mismatches found

Ranked by what a user loses. Each names **both ends with a quoted symbol**, because this project's pages
have already been burned by line drift ([hardening-upgrades.md](./hardening-upgrades.md), header).

### W1 — The provider address settings are ignored by the chat path — **done 2026-10-15**

**Both ends.** *Set and read:* `repos.setSetting('deepseek_endpoint', DEFAULT_PROVIDER_ENDPOINT)` in
`initDatabase()` and `runBootstrap()`, read back by `repos.getSetting('deepseek_endpoint')` in
`deleteProviderSessions`, in the DanyAPI scaffold (now through `ctx.providerEndpoint()`), and by
`getDeepSeekConfig()` in `repos`. *Ignoring it (as found):* a `private readonly baseUrl` field pinned to
the default in `DanyApiProvider`, and the literal default at the two `fetch` sites of the `/api/upload`
branch of `orchestrator/src/index.ts` — both now resolved per call; see the **Fix** below.

**What the user sees when it fires.** Editing `deepseek_endpoint` (or `deepseek_model`) is a silent no-op
for chat, for attachment upload and for the availability probe, and changes only session teardown and the
three `ask_*` MCP tools. Point the app at a provider on another port and it keeps talking to `8000` while
reporting nothing. Three related dead ends sit on the same key: `danyapi_port` is written by
`initDatabase()` and `runBootstrap()` and read by nothing; `getDeepSeekConfig()` has no caller; and
**hardening S3's evidence sentence is wrong** — "The same read also drives `providerManager`'s endpoint
everywhere it is used" names a symbol that does not exist anywhere in the tree (`rg providerManager`
returns nothing), so the setting never reached the adapter.

**Proposed fix.** Give `DanyApiProvider` and the upload branch a resolved base URL from
`repos.getSetting('deepseek_endpoint')` (the same one `deleteProviderSessions` already uses), drop
`danyapi_port` or read it, and correct the S3 sentence.

**Fix.** *(2026-10-15.)* Added `orchestrator/src/providers/endpoint.ts`, exporting
`DEFAULT_PROVIDER_ENDPOINT` (`'http://127.0.0.1:8000/v1'`) and a pure `resolveEndpoint(raw)` that trims,
strips trailing slashes with `.replace(/\/+$/, '')`, and falls back to the default for `null`,
`undefined`, empty, whitespace-only or slash-only values; it imports nothing, so the normalisation is
tested without SQLite. All four consumers now use it. `DanyApiProvider` reads
`resolveEndpoint(repos.getSetting('deepseek_endpoint'))` per call through a private `endpoint()` method —
its `private readonly baseUrl` field is gone, so `isAvailable`, `uploadFile` and `streamChat` follow the
setting without a restart, at the cost of one synchronous `SELECT settings` point read per request, which
is negligible against the network call it precedes. Both `fetch` sites in the `/api/upload` branch of
`orchestrator/src/index.ts` use one `providerEndpoint` const, so the 404 retry now also targets the
resolved host. `deleteProviderSessions` calls the resolver instead of its inline
`String(… || …).replace(…)`. The DanyAPI scaffold reads `ctx.providerEndpoint()`, a new helper in
`PluginManager.scaffoldContext` (`orchestrator/src/plugins/index.ts`) wrapping the same resolver; the
checked-in `orchestrator/plugins/danyapi/mcp.js` mirror was updated to match. The duplicated default
literals in `db/index.ts` (the seed and `getDeepSeekConfig`), `bootstrap/index.ts` and `builtin.ts` were
replaced by the constant, leaving `endpoint.ts` as the only place the literal appears. *Verified:*
`bun test` from `orchestrator/` passes **39 cases across 6 files, exit 0** (was 32 across 5);
`tests/endpoint.test.ts` adds the seven normalisation cases. The wiring was proved by execution, not only
by unit test: a stub `Bun.serve` received `GET /v1/models` and `POST /v1/chat/completions` from the
module-level `danyApiProvider` singleton, and `POST /v1/files` from a real `/api/upload` request against a
booted orchestrator (`CONCLAVE_DATA_DIR` at a temp directory, `PORT=4899`), with the setting pointed at
the stub — nothing reached `127.0.0.1:8000`. *Deliberate deviations:* the `/api/upload` 404 retry keeps
its old body difference (it drops `model`; only the endpoint was fixed, and the retry's trigger is C9's);
*Not
done:* no write validation (S3), no model-handling change (C9), nothing under `client/`.

**Fix (second half, appended the same day).** The paragraph above first ended by recording that
`runBootstrap()` still rewrote `deepseek_endpoint` to the default on every boot, calling it a write-path
defect outside this item's read path. That classification was wrong, and in a way worth stating: **it made
this fix inert across a restart**, so the read of the setting was correct and the setting itself could not
hold a value. `orchestrator/src/bootstrap/index.ts` now seeds three settings only when the key is absent —
`deepseek_enabled`, `deepseek_endpoint` and `danyapi_port` — instead of assigning all three
unconditionally, which also means `deepseek_enabled` can finally be turned **off**; until this change the
boot forced it back to `'true'`, so the toggle was decorative. A fresh database was never affected,
because `db/index.ts` seeds the keys at creation; the unconditional writes only ever clobbered a
database that already had them, which is every database after its first boot.

Proved by a three-boot probe rather than a unit test, because the behaviour is a property of boot against a
real database and a test of it would have to boot the whole module anyway. All three boots ran against one
temporary `CONCLAVE_DATA_DIR`: boot 1 on a fresh directory returned
`endpoint=http://127.0.0.1:8000/v1 enabled=true`; the rows were then rewritten to
`http://127.0.0.1:9911/v1` and `false`; **boot 2 returned `endpoint=http://127.0.0.1:9911/v1
enabled=false`**, where the old code would have reset both; the two rows were then deleted, and boot 3
returned the defaults again — so the seeding still happens, and `getSetting` does not return a truthy
phantom for a missing key, which is the trap a guard written as `if (!getSetting(...))` would fall into
if it did. The pre-change lines are on the record at `HEAD~1`:
`git show 60db719:orchestrator/src/bootstrap/index.ts` shows `repos.setSetting('deepseek_enabled', 'true')`
and the hardcoded endpoint assign.

### W2 — Three server-to-client WS types have no handler on the client — **done 2026-10-15**

**Both ends.** *Sent:* `broadcastWs({ type: 'PROJECT_CREATED', project })` from the `PROJECT_CREATE` case,
`sendWs(ws, { type: 'SETTINGS_UPDATED', settings })` from the `SETTINGS_SET` case, and
`sendWs(ws, { type: 'ERROR', message: ... })` from both the `default` arm and the message-handler `catch`,
all in `orchestrator/src/index.ts`. *Not handled:* the `switch (data.type)` in
`OrchestratorSocketClient.handleMessage` (`orchestratorSocket.svelte.ts`) has no `PROJECT_CREATED`,
`SETTINGS_UPDATED` or `ERROR` case; `rg PROJECT_CREATED client/web/src` and `rg SETTINGS_UPDATED
client/web/src` both return zero hits.

**What the user sees when it fires.** A project created in one window never appears in the other, and a
setting changed in one window (the HUD response duration is the user-visible one, since the overlay
countdown reads it) does not reach the other until a reload. A client message the server rejects is
answered with an `ERROR` the client cannot display, so the only trace is the server log. Contrast with
the client-to-server direction, where the `default` arm's rejection is explicitly designed and recorded as
a *good* pattern in [hardening §7](./hardening-upgrades.md); the server-to-client direction has no such
check, which is exactly why these three were missed.

**Proposed fix.** Add the three cases: `PROJECT_CREATED` → merge into `serverProjects` and `projects`;
`SETTINGS_UPDATED` → re-run the `initFromSettings` settings branch; `ERROR` → surface `data.message` as a
toast or into `pluginError` rather than dropping it.

**Fix.** Applied 2026-10-15 in `client/web`. Three cases were added to the single dispatch site,
`handleMessage`'s `switch (data.type)` in `client/web/src/lib/services/orchestratorSocket.svelte.ts`, and
one new store method backs the first. `PROJECT_CREATED` calls a new
`harness.handleProjectCreated(data.project)` (`client/web/src/lib/stores/harness.svelte.ts`), which upserts
the project into `serverProjects` by `id` and rebuilds the `projects` name list from it — the same shape
`initFromServer` uses — reassigning both arrays rather than mutating, so the sidebar's `$derived`
`projectsToDisplay` re-renders the new project without a reload. `SETTINGS_UPDATED` calls
`harness.initFromSettings({ settings: data.settings })`, the identical path the `SETTINGS_LOADED` case
already uses for its `settings` payload: because `initFromSettings` ends in
`initFromServer(data.projects || [], data.tabs || [])` and `initFromServer` guards both arrays behind a
`length > 0` check, passing only `settings` leaves `serverProjects` and `conversations` untouched while
the receiving window picks up the changed key — `overlay_response_duration` (the user-visible HUD
countdown) included. `ERROR` writes `harness.pluginError`. There is no toast or notification mechanism in
the client (`rg -n "toast|notification" client/web/src` returns nothing) and `pluginError` is its only
rendered slot for a server-broadcast error message — the one the existing `PLUGIN_ERROR` case already
uses — so the rejected-message text lands there rather than being dropped; a `console.warn` accompanies
it. The handler writes only local state and calls no transport, so an `ERROR` cannot provoke another
`ERROR` from the orchestrator. No new state field, no Svelte 4 store and no reactive write at module scope
were introduced.

Verification, all run from `client/web`. `bun test` now runs two files — the F1
`tests/promptDeadline.test.ts` (5 cases) and a new `tests/orchestratorMessageHandlers.test.ts` (5 cases) —
**10 pass, 0 fail, exit 0**. The new file drives real frames through
`OrchestratorSocketClient.handleMessage` by stubbing the Svelte runes globals (`$state`, `$derived.by`)
before a dynamic import, because `bun test` has no Svelte compiler; it asserts that `PROJECT_CREATED`
upserts and updates an existing project without duplicating it, that `SETTINGS_UPDATED` applies the
changed key, that `ERROR` reaches `pluginError`, and that an unknown server type leaves state untouched.
It sits in `tests/` for the same reason as the F1 test: `tsconfig.json` includes `["src", "test", "*"]`,
so a `*.test.ts` under `src/` would drag `bun:test` into the `svelte-check` gate. `bun run check` →
`svelte-check found 0 errors and 6 warnings in 5 files`, exit **0**, identical to the pre-change run
(0 errors, 6 warnings, exit 0); `bun run build` → exit **0**. **Not done:** `orchestrator/` was not
touched, because the sending end needed no change — `rg -n "PROJECT_CREATED|SETTINGS_UPDATED"
orchestrator/src client/web/src` shows `broadcastWs`/`sendWs` sending the three types from
`orchestrator/src/index.ts` (`PROJECT_CREATED` at `:498`/`:502`, `SETTINGS_UPDATED` at `:631`, `ERROR` at
`:639` and `:643`) and, before this change, no `PROJECT_CREATED` or `SETTINGS_UPDATED` hit anywhere in
`client/web/src`; no `PROJECT_RENAMED` or `PROJECT_DELETED` handler was added, because the server sends
neither; and no dedicated toast or global error banner was introduced, so `ERROR` is visible on the
settings-page banner `PLUGIN_ERROR` uses rather than in a new surface — a dedicated always-visible banner
is left to a future change. This page carries no mismatch table to tick; the `**done**` marker is placed
on the section heading, which is the only per-item row this finding has.

### W3 — A plugin's install directory and its manifest id are allowed to differ

**Both ends.** *Directory end:* `installFromGit` derives `const id = (url.split('/').pop() || 'plugin')...`
and clones into `join(this.pluginsDir, id)`. *Manifest end:* it then does
`manifest.id = manifest.id || id` and calls `this.register(manifest)`, which calls
`this.startPlugin(manifest.id, manifest)`; the `bun` branch of `startPlugin` resolves
`join(this.pluginsDir, id)` from that manifest id, and `loadScaffold` resolves
`join(this.pluginsDir, id, manifest.mcp?.scaffold || 'mcp.js')` from it too.

**What the user sees when it fires.** Installing a git plugin whose `plugin.json` declares an `id`
different from its repository name creates the registry row and then fails quietly: a `bun` plugin reports
`bun plugin '<id>' has no installed directory`, and a scaffold plugin logs
`'<id>' MCP scaffold 'mcp.js' not found` and advertises no tools. The plugin looks installed and does
nothing.

**Proposed fix.** Derive the install directory from the resolved `manifest.id` (clone to a temp directory,
read `plugin.json`, then move it to `plugins/<manifest.id>`), or refuse a manifest whose `id` differs from
the slug.

### W4 — `docker compose up -d` can run twice on one boot

**Both ends.** *Caller one:* `supervisor.startAll()` in `orchestrator/src/index.ts`, which loops
`await this.startService(name)` over the service map, and is **not awaited** (hardening F9). *Caller two:*
`pluginManager.restore()` on the next line, whose `startPlugin` `docker` branch calls
`await supervisor.startService(service)` for the built-in DanyAPI plugin.

**Characterisation, as asked.** The second call is *redundant when the first has finished and harmful when
it has not*. `startService` opens with the fast path `if (await this.pingService(service.port))`, which
prints `is already running and healthy` and returns, so a sequential second call is a no-op once the
container answers on `/v1/models`. But `startAll` is not awaited, so `restore()` runs concurrently with it,
both see a dead port, both pass the `pingService` re-check inside `startDockerService`, and both reach
`spawnSync('docker', ['compose', 'up', '-d'], ...)`. The second invocation is at best a wasted compose
lock wait and at worst a container recreate; each call also runs `attachLogStreamer`, which kills the
previous `docker compose logs -f` child and starts a new one, and each runs `recordState`. It is not
deliberate: the `startPlugin` comment says only "Docker plugins are executed by the supervisor's
docker-compose flow", which is true of the delegation and silent about the duplicate.

**Proposed fix.** `await supervisor.startAll()` in `orchestrator/src/index.ts` (F9's fix, which also
serialises the race), and have the `docker` branch of `startPlugin` read
`supervisor.getStatus().find((s) => s.name === service)?.status` first and only delegate when it is not
already running.

### W5 — The bootstrap log line names a database path that is usually not the one written

**Both ends.** *The claim:* `console.log('[Bootstrap] SQLite database initialized at
orchestrator/data/conclave.db')` in `runBootstrap()` (`orchestrator/src/bootstrap/index.ts`). *The fact:*
`export const DATA_DIR = process.env.CONCLAVE_DATA_DIR || join(import.meta.dir, '../../data')` in
`orchestrator/src/db/index.ts`, and the file is `join(DATA_DIR, 'conclave.db')`.

**What the user sees when it fires.** A false claim in a log, not a functional defect. The string is
correct only in a dev run with `CONCLAVE_DATA_DIR` unset; under the Tauri sidecar the loader sets that
variable to `app.path().app_data_dir()`, so the database is written to the OS app-data directory while the
log still says `orchestrator/data/`. Anyone debugging a shipped app by this line is looking in a directory
that does not exist.

**Proposed fix.** Log `DB_PATH` (or `DATA_DIR`) from the module that owns it, rather than a second
hardcoded copy of the path; `runBootstrap` already imports from `../db`.

### W6 — The client's fallback project id names a project the server never seeds

**Both ends.** *Client literal:* `const projectId = proj ? proj.id : (this.serverProjects[0]?.id || '112')`
in `createConversation`, and the same `this.serverProjects[0]?.id || '112'` in the branch of
`handleTabDetail` that fabricates a conversation. *Server seed:* `initDatabase()` creates the placeholder
project with `newProjectId(nextSeq('project'))`, whose first value is `'111'` (project ids are 3 Base58
chars padded with `1`), never `'112'`.

**What the user sees when it fires.** Only when `serverProjects` is empty (before the first
`SETTINGS_LOADED`), a locally created conversation is stamped with `project_id: '112'`, which the sidebar
then groups under a project that does not exist. It self-heals on the next settings load. The `'1112'`
fallback in the overlay is the one that *does* match; this one is a stale second value.

**Proposed fix.** Fall back to `'111'`, the project the seed actually creates, rather than to the next
sequence number in the same shape.

### W7 — The checked-in DanyAPI plugin files are a second source of truth that nothing reads

**Both ends.** *Read at runtime:*
`BUILTIN_PLUGINS` in `orchestrator/src/plugins/builtin.ts`, whose `files: { 'mcp.js': DANYAPI_MCP_JS }`
is seeded into `<DATA_DIR>/plugins/danyapi/` by `restore()` and whose `mcp.tools` list is what
`listMcpTools` advertises. *Read by nothing:*
`orchestrator/plugins/danyapi/plugin.json` and `orchestrator/plugins/danyapi/mcp.js`. Every hit for either
path outside the docs is `installFromGit` reading a `plugin.json` out of a freshly cloned *git* plugin, so
the checked-in pair is never loaded, and the two declared tool lists are kept in sync only by hand (the
comment on `BUILTIN_PLUGINS` asserts the mirror).

**What the user sees when it fires.** Nothing, until someone edits the `.js` and waits for an effect that
cannot come. The failure mode is a wasted debug cycle plus a silent divergence risk: change one copy and
the docs, the tests and the running scaffold disagree.

**Proposed fix.** Either make `builtin.ts` read the checked-in files at build time, or delete the
checked-in pair and say in the manifest that `builtin.ts` is the only copy; a one-line assertion that the
two strings are equal would at least fail loudly.

## 4. The two leads, confirmed or refuted

**Lead A — the DanyAPI plugin also calls `startService`, so a boot runs `docker compose up -d` twice.
Confirmed, with the qualification above (W4).** The two callers are `supervisor.startAll()` at the top
level of `orchestrator/src/index.ts` and `pluginManager.restore()` on the following line, reached through
`PluginManager.startPlugin`'s `await supervisor.startService(service)` branch for a manifest of
`type: 'docker'`. Order: bootstrap is awaited, then `startAll()` is invoked and abandoned, then
`restore()` is invoked and abandoned; the two then interleave. Whether the second run is *harmful* depends
on timing, not on intent: it is a no-op when the first has already made `/v1/models` answer, and a
concurrent duplicate compose invocation when it has not. The mitigation already in the tree is the
`pingService` fast path in `startService`.

**Lead B — `[Bootstrap] SQLite database initialized at orchestrator/data/conclave.db` is wrong whenever
`CONCLAVE_DATA_DIR` is set. Confirmed.** The line is hardcoded in `runBootstrap()`
(`orchestrator/src/bootstrap/index.ts`), quoted in full:

```ts
console.log('[Bootstrap] SQLite database initialized at orchestrator/data/conclave.db');
```

It disagrees with `DATA_DIR`/`DB_PATH` in `orchestrator/src/db/index.ts`, which is what actually decides
the location. It is a false claim in a log rather than a functional defect: the database is created
correctly wherever `CONCLAVE_DATA_DIR` points, and only the message is wrong. See W5 for the fix.

## 5. Not covered, and the edges of the sweep

- **Nothing was executed.** No container was started and no orchestrator was booted, so every "the request
  is built as X" verdict is a read of the request-building code, not an observed request. The two leads
  were confirmed by reading both ends, not by watching a boot.
- **The provider end is a recorded surface, not a live one.** `POST /v1/files` and `/v1/sessions/<id>` live
  only in `mindflowgo/DanyAPI`'s `openai.py`, which is not on this machine; the multipart field names the
  upload path sends (`file`, `session_id`, `model`) were checked against what Conclave reads and against
  the fork record in [DanyAPI review](./danyapi-review.md), not against the fork's own handler. The
  snapshot at `.agent-resources/DanyAPI-prod/` has no multipart upload route at all, so it cannot arbitrate
  this one.
- **Model ids and caps were not re-audited.** The six declared ids, the `/v1/files` version skew and the
  10 MB / 50-file caps are already carried in full by [DanyAPI review §4-§5](./danyapi-review.md) and
  hardening C6/C8/C9.
- **A cross-compiled sidecar triple mismatch is possible and not claimed as a defect.** `build.rs` derives
  the sidecar name from cargo's `TARGET`, while `scripts/build-sidecar.ts` derives it from the host
  (`rustc -Vv`), so a cross-build would produce `orchestrator-<host>` where Tauri and the loader look for
  `orchestrator-<target>`. `SIDECAR_TRIPLE` exists to override it and Tauri fails loudly when the
  `externalBin` file is absent, so this is a conditional mismatch rather than a silent one. It was not
  exercised, because no cross-build was run and no target other than the host is set up here.
- **`client/web/src/routes/api/chat/+server.ts`'s fake tool-step shape was not compared to the real one.**
  features.md's stub ledger already records that no real provider yields `tool_step`, so the
  `TOOL_STEP_UPDATE` payload shape the client expects has no producer on the real path and cannot be
  verified end to end. The client's field reads (`title`, `status`, `details[].action/detail/status`,
  `badgeCount`) and the router's `step: event.data` agree by inspection only.
- **Nothing under `orchestrator/`, `client/`, `scripts/` or `crates/` was modified, and no state-changing
  `git` command was run.** `git status --porcelain` was empty before and after this audit except for this
  page and the map row.

## Related

- [Hardening and upgrades](./hardening-upgrades.md) — the prioritised defect plan this page's seams sit
  beside; C1 is the reference instance of the class
- [DanyAPI review](./danyapi-review.md) — the provider's real surface, and §3 is the route list W1 and the
  §4 table were checked against
- [Complete feature inventory](./features.md) — the working/partial/stub ledger, including the
  `CONCLAVE_PROJECT_ROOT` and `ask_zai` findings this page treats as already known
- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — §4.2, the two silent rename
  pairs, and the env-var readers
- [Documentation map](./index.md) — the map this page hangs from
