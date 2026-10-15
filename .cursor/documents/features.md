---
title: Conclave — complete feature inventory
topic: conclave-features
updated: 2026-10-15
status: current
---

# Conclave — complete feature inventory

This page is the feature map for the comprehensive upgrade of Conclave. It was read out of the source
tree at `.agent-repositories/conclave`, not out of `ARCHITECTURE.md`; where the two disagree, the code
is the authority and §2 records the disagreement. Every entry below carries a `file:line`, and every
entry is tagged with its real state:

- **[W] working** — reachable from the running application and implemented end to end.
- **[P] partial** — reachable but incomplete: hard-coded where it should be dynamic, one platform
  only, or wired to a producer that emits nothing.
- **[S] stub or dead** — present in the tree but never executed on any real path.

The counts are in §10. The tree has a second page, the
[dependency audit](./conclave-dependency-audit.md), and its provenance and rename footprint are on
[the Conclave page](./conclave.md).

---

## 1. What the tree actually is

Four processes, wired in a line:

| Layer | Path | What it does |
|---|---|---|
| Desktop shell | [`client/tauri/src-tauri/src/lib.rs`](../../client/tauri/src-tauri/src/lib.rs) | Tauri v2. Owns two webview windows, the window-state file, and the single WebSocket to the orchestrator |
| Web client | [`client/web/src`](../../client/web/src) | SvelteKit 5 + Tailwind 4 SPA, prerendered, `ssr = false` ([`+layout.ts:1-2`](../../client/web/src/routes/+layout.ts)) |
| Orchestrator | [`orchestrator/src/index.ts`](../../orchestrator/src/index.ts) | Bun HTTP + WebSocket server on `127.0.0.1:4000`, `bun:sqlite` store, LLM router, plugin engine, Docker supervisor |
| Container | [`orchestrator/plugins/danyapi/plugin.json`](../../orchestrator/plugins/danyapi/plugin.json) | DanyAPI on Docker, OpenAI-compatible on `127.0.0.1:8000` |

The transport is unusual and worth stating up front, because the upgrade will touch it: the WebSocket
is owned by the **Rust** process, not by JavaScript. [`orchestrator_ws.rs:1-6`](../../client/tauri/src-tauri/src/orchestrator_ws.rs)
spawns a supervisor that connects to `ws://127.0.0.1:4000/ws`, feeds every inbound frame to the
webviews as the `orchestrator-message` Tauri event, and exposes outbound sends through the `ws_send`
command. The browser never opens a socket.

---

## 2. Where `ARCHITECTURE.md` and the code disagree

Five claims do not survive a read of the source. Each is a documentation bug the upgrade should fix
in the same change that touches the behaviour.

| Claim | Where | What the code says |
|---|---|---|
| "The idle minimalist HUD dimensions are rigidly invariant at `200×56` px across Rust and TypeScript", and the same number appears four times in `UI.md` | [`ARCHITECTURE.md:747`](../../ARCHITECTURE.md), [`UI.md:144`](../../UI.md), `:164`, `:167`, `:190` | The real constant is **300×56**: [`lib.rs:9`](../../client/tauri/src-tauri/src/lib.rs) `IDLE_HUD_WIDTH = 300.0`, [`windowManager.ts:21`](../../client/web/src/lib/services/windowManager.ts), [`overlay/+page.svelte:33`](../../client/web/src/routes/overlay/+page.svelte). Nothing anywhere uses 200 |
| "When `Deepseek v4` is selected, the orchestrator … sends `model: 'default'`" | [`ARCHITECTURE.md:367`](../../ARCHITECTURE.md) | No such normalisation exists. `rg` for `'default'` in `orchestrator/src/providers`, `router` and `index.ts` returns nothing; [`danyapi.ts:64`](../../orchestrator/src/providers/danyapi.ts) is `model \|\| this.models[0].id`. The literal display string `'Deepseek v4'` is passed through as the model id, and it is reachable from [`harness.svelte.ts:777`](../../client/web/src/lib/stores/harness.svelte.ts) and [`NewChatModal.svelte:43`](../../client/web/src/lib/components/NewChatModal.svelte) |
| Uploads "persist to `api_sandbox/data`" | [`ARCHITECTURE.md:665`](../../ARCHITECTURE.md) | The path is `$CONCLAVE_DATA_DIR/attachments` in production ([`index.ts:262-268`](../../orchestrator/src/index.ts)); the sandbox path is the dev fallback only |
| "Active Tools: 6 tools" | [`settings/+page.svelte:269`](../../client/web/src/routes/(desktop)/settings/+page.svelte) | The orchestrator's own built-ins number **four** ([`mcp/index.ts:42-88`](../../orchestrator/src/mcp/index.ts)); the "six" counts the two DanyAPI plugin tools and is hard-coded text, not a live count |
| `SETTINGS_UPDATED` is documented as a broadcast | [`ARCHITECTURE.md:598`](../../ARCHITECTURE.md) | It is sent to the requesting socket only ([`index.ts:628`](../../orchestrator/src/index.ts)), never broadcast |

---

## 3. Desktop shell (Tauri)

**Windows.** Two webviews are declared, `main` (1240×820, `titleBarStyle: Overlay`) and `overlay`
(300×76 at rest, frameless, transparent, `alwaysOnTop`, `skipTaskbar`, routed to `/overlay`). Both
windows are named in one capability file, which grants the full window-control set including
`set-always-on-top` and `start-dragging`: [`tauri.conf.json:15-44`](../../client/tauri/src-tauri/tauri.conf.json),
[`capabilities/default.json:5-32`](../../client/tauri/src-tauri/capabilities/default.json). **[W]**

**Window state.** Two rectangles, `normal` and `minimalist`, plus a `mode` string, persisted to
`~/.conclave.json` by native commands and mirrored into `localStorage` by the web layer:
[`lib.rs:12-45`](../../client/tauri/src-tauri/src/lib.rs), [`lib.rs:129-148`](../../client/tauri/src-tauri/src/lib.rs),
[`windowManager.ts:131-177`](../../client/web/src/lib/services/windowManager.ts). **[W]**

**Move tracking.** `on_window_event` persists `Moved` coordinates per window label, converting
physical to logical with the scale factor; the overlay records position only and re-pins its size to
300×56: [`lib.rs:356-374`](../../client/tauri/src-tauri/src/lib.rs). **[W]**

**Multi-monitor clamping.** `clamp_overlay_position` and `clamp_main_position` validate a saved
target against `available_monitors()`, subtracting a margin, and fall back to
`(primary.x + 24, primary.y + 100)` when the monitor is gone: [`lib.rs:56-112`](../../client/tauri/src-tauri/src/lib.rs). **[W]**

**Platform scope.** The overlay targets Windows and Linux only. Its always-on-top level is Tauri's
portable `set_always_on_top`, applied in [`lib.rs`](../../client/tauri/src-tauri/src/lib.rs); an
earlier platform-specific setup hook set the native window's `NSWindowCollectionBehavior`
(`CanJoinAllSpaces | FullScreenAuxiliary | IgnoresCycle`) through `objc2::msg_send!` to float the HUD
above fullscreen apps on every Space, and that hook, its call sites and the `objc2` dependency have
all been removed. **[W]**

**Overlay mode transition.** `enter_overlay_mode` captures the live main-window rect (only if wider
than 500px, so an already-shrunk window does not overwrite the good bounds), hides main, clamps and
shows overlay, and saves:
[`lib.rs:155-202`](../../client/tauri/src-tauri/src/lib.rs). `exit_overlay_mode(tab_id)` does the
reverse and emits `refresh-active-thread` to the main webview directly from Rust:
[`lib.rs:205-236`](../../client/tauri/src-tauri/src/lib.rs). **[W]**

**Overlay sizing.** `set_overlay_size` clamps both axes up to the idle floor before applying:
[`lib.rs:272-282`](../../client/tauri/src-tauri/src/lib.rs). `set_window_always_on_top` is a thin
wrapper: [`lib.rs:267-270`](../../client/tauri/src-tauri/src/lib.rs). **[W]**

**Lifecycle teardown.** `exit_app` and `RunEvent::Exit*` tear the side-loaded orchestrator down when
the app exits: [`lib.rs`](../../client/tauri/src-tauri/src/lib.rs). A prior `RunEvent::Reopen` handler
that unhid and focused the main window on a platform dock event has been removed with the
platform-specific setup. **[W]**

**Orchestrator side-load.** Production runs the bundled sidecar next to the executable; dev spawns
`bun src/index.ts` from a located source directory; a port already open is reused and left running,
and only a process the shell spawned is killed on exit (SIGTERM, 500 ms grace, then kill):
[`orchestrator_loader.rs:39-144`](../../client/tauri/src-tauri/src/orchestrator_loader.rs). **[W]**

**WebSocket transport.** A capped exponential backoff loop (1 s → 15 s, reset after a 30 s healthy
connection), a live reader task whose abort handle forces a reconnect, an outbound queue capped at 64
payloads that survives the reconnect, manual `Pong` replies because split sinks do not auto-reply,
and re-queueing of unflushed text on write failure:
[`orchestrator_ws.rs:25-198`](../../client/tauri/src-tauri/src/orchestrator_ws.rs). **[W]**

---

## 4. Web client (SvelteKit 5)

**Routing.** Two route groups: `(desktop)` with a sidebar layout, and `overlay` with a transparent
root: [`(desktop)/+layout.svelte`](../../client/web/src/routes/(desktop)/+layout.svelte),
[`overlay/+layout.svelte:13-29`](../../client/web/src/routes/overlay/+layout.svelte). The whole app
is `prerender = true, ssr = false` ([`+layout.ts:1-2`](../../client/web/src/routes/+layout.ts)). **[W]**

**Store.** One rune-based singleton holds projects, conversations, tabs, models, providers, plugin
list, settings, sort order, sidebar state and the active model, plus the derived views
(`filteredConversations`, `groupedConversations`, `displayedMessages`, `openTabs`) and every action:
[`harness.svelte.ts:81-806`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**

**Socket bridge.** All protocol semantics live in JS while the transport lives in Rust: the client
listens for `orchestrator-message` and `orchestrator-status`, drains `ws_status` on load to catch a
connection it did not observe, and coalesces `LOAD_SETTINGS` **across windows** with a
`localStorage` timestamp so two webviews do not double-load:
[`orchestratorSocket.svelte.ts:31-104`](../../client/web/src/lib/services/orchestratorSocket.svelte.ts),
[`harness.svelte.ts:430-448`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**

**Sidebar.** Projects with their threads sorted by `updated_at`, the top six rendered with a
`Show all (N) ▾` / `Show less ▴` toggle, an orphan-thread bucket for conversations whose project no
longer exists, an inline new-project input, an optional search field, the provider filter, and an
archived section: [`Sidebar.svelte:109-126`](../../client/web/src/lib/components/Sidebar.svelte),
[`Sidebar.svelte:285`](../../client/web/src/lib/components/Sidebar.svelte),
[`Sidebar.svelte:394`](../../client/web/src/lib/components/Sidebar.svelte),
[`Sidebar.svelte:481-500`](../../client/web/src/lib/components/Sidebar.svelte). **[W]**

**Thread operations.** A fixed-position hover menu per thread with rename (inline input), archive and
markdown export; the store implements `renameConversation`, `archiveConversation`,
`downloadConversation` (Blob + anchor download) and `deleteConversation`:
[`Sidebar.svelte:33-84`](../../client/web/src/lib/components/Sidebar.svelte),
[`harness.svelte.ts:520-583`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**

**Tabs strip.** Open tabs with close, active-tab fallback to the last remaining tab, and the project /
thread breadcrumb: [`harness.svelte.ts:196-215`](../../client/web/src/lib/stores/harness.svelte.ts),
[`TabsHeader.svelte:33-43`](../../client/web/src/lib/components/TabsHeader.svelte). **[W]**

**New-chat modal.** Project-group picker and an optional project directory that is persisted as
`conclave_last_project_dir`: [`NewChatModal.svelte:88-146`](../../client/web/src/lib/components/NewChatModal.svelte),
[`harness.svelte.ts:105`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**

**Markdown and code.** `marked` with a custom renderer wrapping `highlight.js`; blocks over 15 lines
collapse to 280px with a fade overlay and a `Show all (N lines)` bar; the header carries a language
badge and a copy button driven by click delegation and a `data-code` attribute:
[`ConversationView.svelte:9-64`](../../client/web/src/lib/components/ConversationView.svelte),
[`ConversationView.svelte:94-147`](../../client/web/src/lib/components/ConversationView.svelte). **[W]**

**Reasoning blocks.** `<think>…</think>` is stripped, HTML-escaped and rendered as a `<details>`
"Reasoning Process" box, open by default: [`ConversationView.svelte:158-179`](../../client/web/src/lib/components/ConversationView.svelte). **[W]**

**Long user messages.** Line-clamped to four lines with a `… Show more` toggle above ~280 chars:
[`ConversationView.svelte:303-318`](../../client/web/src/lib/components/ConversationView.svelte). **[W]**

**Scrolling.** A single `$effect` distinguishes conversation switch, user send and assistant append,
centring the new user turn and smooth-scrolling the assistant turn, then sticks to the bottom during
streaming only if within 200px of it: [`ConversationView.svelte:183-227`](../../client/web/src/lib/components/ConversationView.svelte). **[W]**

**Sort order.** `messageSortOrder` and `toggleMessageSortOrder`, surfaced in the metadata bar as
`Newest first ↓` / `Oldest first ↑`:
[`harness.svelte.ts:121`](../../client/web/src/lib/stores/harness.svelte.ts),
[`ConversationView.svelte:271-277`](../../client/web/src/lib/components/ConversationView.svelte). **[W]**

**Token usage.** `getModelName` resolves an id to a display name from the model list; the per-message
count is read back from `usage.totalTokens` on fetch:
[`ConversationView.svelte:149-153`](../../client/web/src/lib/components/ConversationView.svelte),
[`harness.svelte.ts:687-691`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**

**Prompt dock.** Auto-growing textarea capped at 140px, Enter-to-send and Shift+Enter for a newline,
a model dropdown driven from `availableModels`, click-outside dismissal:
[`PromptInput.svelte:51-103`](../../client/web/src/lib/components/PromptInput.svelte),
[`PromptInput.svelte:265-266`](../../client/web/src/lib/components/PromptInput.svelte). **[W]** — except
its voice button, which carries a `title="Voice input"` and no handler:
[`PromptInput.svelte:345-352`](../../client/web/src/lib/components/PromptInput.svelte).

**Attachments.** Multi-file input plus drag-and-drop, per-file uploading/ready/error status chips,
and a `POST /api/upload` per file with the error body surfaced to the chip:
[`PromptInput.svelte:105-182`](../../client/web/src/lib/components/PromptInput.svelte). **[W]** (it depends
on DanyAPI being up; see §5.)

**Settings.** Four tabs. The default is `mcp`, and the tab can be deep-linked with `?tab=`:
[`settings/+page.svelte:28-29`](../../client/web/src/routes/(desktop)/settings/+page.svelte),
[`settings/+page.svelte:106-113`](../../client/web/src/routes/(desktop)/settings/+page.svelte). **[W]**

- MCP tab: generated client config for a production binary or a dev Node script, a copy-paste prompt,
  per-client file locations, a declared tool list, and a terminal test command:
  [`settings/+page.svelte:35-69`](../../client/web/src/routes/(desktop)/settings/+page.svelte),
  [`settings/+page.svelte:438-524`](../../client/web/src/routes/(desktop)/settings/+page.svelte). **[P]** —
  the tool list is hard-coded prose and the dev path is a developer's own checkout, see §9.
- General tab: the live model list from `harness.availableModels` and the overlay auto-dismiss
  duration, which is persisted to both `localStorage` and the `settings` table:
  [`settings/+page.svelte:529-561`](../../client/web/src/routes/(desktop)/settings/+page.svelte),
  [`harness.svelte.ts:404-410`](../../client/web/src/lib/stores/harness.svelte.ts). **[W]**
- Plugins tab: install-from-git-URL, the plugin list with status dot, tool/model counts, an enable
  checkbox and remove: [`settings/+page.svelte:663-765`](../../client/web/src/routes/(desktop)/settings/+page.svelte). **[W]**
- Engine tab: transport, MCP endpoint, database path and the ID scheme — but as **static text**, with
  a hard-coded green "Docker Active" badge that does not read `orchestratorSocket.services`:
  [`settings/+page.svelte:767-820`](../../client/web/src/routes/(desktop)/settings/+page.svelte). **[P]** —
  the data is already in the store and simply not bound.

**Theming.** Tailwind 4 imported through `@tailwindcss/vite` with no config file, a
`scrollbar-width: thin` base layer, and a single dark palette hard-coded through the markup:
[`vite.config.ts:7-29`](../../client/web/vite.config.ts),
[`app.css:1-19`](../../client/web/src/app.css),
[`app.html:2`](../../client/web/src/app.html). **[P]** — there is no light theme and no token layer to
introduce one.

**Window drag.** A guarded `startDragging` that ignores non-primary buttons and interactive
selectors: [`drag.ts:5-28`](../../client/web/src/lib/utils/drag.ts). **[W]**

**Cross-window refresh.** The desktop layout reacts to four independent signals (native
`refresh-active-thread`, Tauri `switch-tab`, the `storage` event on two keys, and focus/visibility)
all funnelled through one debounced handler:
[`(desktop)/+layout.svelte:14-79`](../../client/web/src/routes/(desktop)/+layout.svelte). **[W]**

### 4.1 The ambient HUD

The overlay is a five-state machine (`idle` / `prompt` / `thinking` / `response` / `error`):
[`overlay/+page.svelte:37`](../../client/web/src/routes/overlay/+page.svelte). **[W]**

- Brain click expands to prompt at 480×80 (floor 380×68), fading the textarea in:
  [`overlay/+page.svelte:202-211`](../../client/web/src/routes/overlay/+page.svelte).
- Submit collapses back to idle while generation continues in the background; a **60-second** guard
  turns a silent hang into an error card:
  [`overlay/+page.svelte:249-283`](../../client/web/src/routes/overlay/+page.svelte).
- The response card sizes to 480–750 wide, honours `settings.overlayResponseDuration`, and counts
  down with a pause-on-hover rule:
  [`overlay/+page.svelte:320-350`](../../client/web/src/routes/overlay/+page.svelte).
- `popExternalResponse` / `popExternalError` surface a completion or failure that belongs to a prompt
  started in the other window, and adopt its conversation:
  [`overlay/+page.svelte:283-310`](../../client/web/src/routes/overlay/+page.svelte).
- A pointer-drag resize grip with `requestAnimationFrame` throttling, sizing bounds per state, and
  `localStorage` persistence of the prompt dimensions:
  [`overlay/+page.svelte:520-600`](../../client/web/src/routes/overlay/+page.svelte).
- A chrome overlay holding the `⋮` menu (Restore Full Window, Quit Conclave) and the six-dot grip;
  the quit path calls native `exit_app`:
  [`overlay/+page.svelte:785-844`](../../client/web/src/routes/overlay/+page.svelte).
- Handback: `handleOpenInChat` and `handleRestore` both write `conclave_active_tab` and
  `conclave_refresh_ts`, emit `switch-tab` and `refresh-active-thread`, and call
  `exitMinimalistWindow(tabId)`:
  [`overlay/+page.svelte:362-393`](../../client/web/src/routes/overlay/+page.svelte).

---

## 5. Orchestrator (Bun / TypeScript)

**Server.** One `Bun.serve` with HTTP and WebSocket on the same port, default `4000`:
[`index.ts:12`](../../orchestrator/src/index.ts), [`index.ts:103`](../../orchestrator/src/index.ts). **[W]**

**Origin guard and CORS.** Every request is checked before routing; a foreign browser origin is
answered `403 Forbidden: Untrusted Origin`. `tauri:`, `app:`, `localhost`, `127.0.0.1` and
`tauri.localhost` pass, and a missing `Origin` passes for CLI tools. The CORS header reflects the
validated origin rather than `*`:
[`index.ts:83-101`](../../orchestrator/src/index.ts), [`index.ts:108-113`](../../orchestrator/src/index.ts). **[W]**

**The handshake.** On socket open the server sends `SERVER_READY`; on `LOAD_SETTINGS` it answers
`SETTINGS_LOADED` with projects, tabs, settings, services, models **and plugins** in one payload, and
logs a summary line:
[`index.ts:385-400`](../../orchestrator/src/index.ts), [`index.ts:401-420`](../../orchestrator/src/index.ts). **[W]**

**Client → server messages handled:** `LOAD_SETTINGS`, `TAB_FETCH`, `TAB_CREATE`, `TAB_RENAME`,
`TAB_DELETE`, `TAB_ARCHIVE`, `PROJECT_CREATE`, `PROMPT_SEND`, `MCP_REQUEST`, `PLUGIN_LIST`,
`PLUGIN_INSTALL`, `PLUGIN_REMOVE`, `PLUGIN_TOGGLE`, `SETTINGS_SET`, with a default arm that answers
`ERROR` for anything unknown: [`index.ts:400-638`](../../orchestrator/src/index.ts). **[W]**

**Streaming.** `PROMPT_SEND` runs `llmRouter.streamChat` and fans the generator out to `CHAT_TOKEN`,
`TOOL_STEP_UPDATE`, `CHAT_USAGE`, `CHAT_ERROR` and `CHAT_COMPLETE`, then broadcasts `TAB_UPDATED` so
other windows refetch: [`index.ts:502-569`](../../orchestrator/src/index.ts). **[W]**

**Broadcast.** `broadcastWs` writes to every socket in `readyState === 1` with a byte-size log line:
[`index.ts:66-81`](../../orchestrator/src/index.ts). Tab and plugin events are broadcast; the
`pluginBus` `tab-created`/`tab-updated` events are bridged to the same channel:
[`index.ts:25-37`](../../orchestrator/src/index.ts). **[W]**

**Provider sessions.** `deleteProviderSessions` best-effort `DELETE`s
`<endpoint>/session/<tabId>` (3 s timeout) for every enabled provider before a tab row is removed —
on both the WS `TAB_DELETE` and the HTTP `DELETE /api/tabs/:id` path. **[W]** but see the DanyAPI
version skew on [the Conclave page](./conclave.md#5-the-danyapi-coupling-and-where-the-tree-diverges):
only a fork image answers that route.
[`index.ts:44-61`](../../orchestrator/src/index.ts), [`index.ts:210-219`](../../orchestrator/src/index.ts).

**HTTP surface.** `/health` (bootstrap result, supervisor status, project and tab counts, uptime),
`/api/settings/load` and its alias `/api/bootstrap`, `/api/tabs`, `/api/tabs/:id/messages?days=N`,
`DELETE /api/tabs/:id`, `/api/projects`, `/api/settings`, `/api/log`, `/api/upload`, `/mcp`, and a
one-line fallback body for everything else:
[`index.ts:158-171`](../../orchestrator/src/index.ts), [`index.ts:174-185`](../../orchestrator/src/index.ts),
[`index.ts:188-246`](../../orchestrator/src/index.ts), [`index.ts:384-386`](../../orchestrator/src/index.ts). **[W]**

**Upload pipeline.** `/api/upload` accepts `file`/`files` plus `session_id` and `model`, writes each
file under `$CONCLAVE_DATA_DIR/attachments` (dev fallback `api_sandbox/data`) with a sanitised name,
forwards it to DanyAPI `POST /v1/files` with a `default`-model 404 retry, records the row in the
`uploads` table, and fails the whole request with `502` if any file's forward failed:
[`index.ts:244-380`](../../orchestrator/src/index.ts). **[W]** — with one caveat recorded in §10: the
`uploads` row is written and never read.

**SQLite store.** Nine tables (`counters`, `projects`, `tabs`, `messages`, `tool_steps`, `settings`,
`uploads`, `service_state`, `plugins`), WAL mode and foreign keys on:
[`db/schema.ts:6-98`](../../orchestrator/src/db/schema.ts),
[`db/index.ts:20-21`](../../orchestrator/src/db/index.ts). The repository object covers projects,
tabs (create/rename/archive/delete/last-response/ensure), messages (add, filtered fetch with a
latest-50 fallback and nested tool-step hydration), tool steps, settings and plugins:
[`db/index.ts:59-234`](../../orchestrator/src/db/index.ts). **[W]**

**Base58 ID scheme.** A counter table feeds fixed-width sequential ids for projects (3) and tabs (4);
messages are `tabId + 6-char seconds + 2-char random` and tool steps `6+2`:
[`db/helper.ts:54-81`](../../orchestrator/src/db/helper.ts). **[W]**

**Migrations and seed.** `initDatabase` adds the `archived` column if missing, renames a legacy
`General` project to `Discussions`, and on an empty store seeds one project, one tab and nine
settings: [`db/index.ts:33-71`](../../orchestrator/src/db/index.ts). **[W]**

**Provider abstraction.** A `ProviderAdapter` interface (`streamChat` async generator, optional
`uploadFile`, `isAvailable`, `models`) with `ProviderChatOptions`, `AttachmentMeta` and
`ModelDescriptor`: [`providers/types.ts:1-46`](../../orchestrator/src/providers/types.ts). **[W]**

**DanyAPI adapter.** Six hard-coded model descriptors, availability by `GET /v1/models`, an SSE reader
that strips `data: `, skips `[DONE]`, raises on an in-band `error`/`detail`, yields `token` per delta
and one `usage` chunk from `total_tokens`, with a 60 s `AbortController`:
[`danyapi.ts:4-11`](../../orchestrator/src/providers/danyapi.ts),
[`danyapi.ts:59-167`](../../orchestrator/src/providers/danyapi.ts). `uploadFile` posts multipart to
`/v1/files`: [`danyapi.ts:30-57`](../../orchestrator/src/providers/danyapi.ts). **[W]**

**Router.** `streamChat` persists the user message, delegates to `getProvider(provider)`, accumulates
the full response, extracts `totalTokens`, and on error cleans the provider message, appends it to
the response as a blockquote, and yields both a `token` and an `error` event so the transcript still
records the failure; it always finishes by persisting the assistant message and the tab snippet:
[`router/index.ts:29-105`](../../orchestrator/src/router/index.ts). **[W]**

**Provider selection is cosmetic.** `getProvider` maps every name — `deepseek`, `dany`, `qwen`,
`default`, unknown or empty — to the single DanyAPI adapter, and the comment marks the extension
point: [`providers/index.ts:18-24`](../../orchestrator/src/providers/index.ts). **[P]** — sending
`provider: 'Claude'` reaches DanyAPI.

**Supervisor.** Detects Docker, offers `open -a Docker` on a cold daemon, skips a disabled service,
short-circuits when the port already answers, runs `docker compose up -d`, attaches a
`docker compose logs -f` streamer into stdout/stderr, polls `/v1/models` ten times at one second
intervals, and records every state change:
[`processes/supervisor.ts:50-267`](../../orchestrator/src/processes/supervisor.ts). **[W]**

**Bootstrap.** Initialises the DB, resolves the sandbox directory (and skips it entirely when
`CONCLAVE_DATA_DIR` is set, with a comment explaining that a shipped app must not clone repos),
shallow-clones or pulls `mindflowgo/DanyAPI`, seeds a `.env` from `DanyAPI_settings` or defaults, and
writes the bootstrap settings:
[`bootstrap/index.ts:12-117`](../../orchestrator/src/bootstrap/index.ts). **[W]**

**Plugin engine.** Three manifest types, implemented as instructed:

- `mcp` — `McpStdioClient` spawns the command, splits newline-delimited JSON-RPC, resolves pending
  requests by id with per-request timeouts, rejects everything and marks `failed` on process exit,
  and enumerates tools via `tools/list`:
  [`plugins/index.ts:60-170`](../../orchestrator/src/plugins/index.ts). **[W]**
- `bun` — spawns `bun run <entrypoint>` in the plugin dir and health-checks the declared port,
  treating a `404` as alive:
  [`plugins/index.ts:466-500`](../../orchestrator/src/plugins/index.ts),
  [`plugins/index.ts:581-592`](../../orchestrator/src/plugins/index.ts). **[W]** — no shipped plugin
  uses this type, so the path has no live instance.
- `docker` — delegates to `supervisor.startService` and mirrors the service's status:
  [`plugins/index.ts:501-516`](../../orchestrator/src/plugins/index.ts). **[W]**

**Plugin lifecycle.** `restore()` re-seeds built-in files (never overwriting a user edit), syncs
built-ins into the registry while preserving the enabled flag, then starts every enabled plugin:
[`plugins/index.ts:184-217`](../../orchestrator/src/plugins/index.ts). `installFromGit` clones with
`--depth 1`, requires a `plugin.json`, and cleans up on failure:
[`plugins/index.ts:265-292`](../../orchestrator/src/plugins/index.ts). `remove` stops, deletes the row
and deletes the directory: [`plugins/index.ts:317-323`](../../orchestrator/src/plugins/index.ts).
`toggle` writes the flag and, for a docker plugin, flips the `deepseek_enabled` setting so the
supervisor respects it on the next boot:
[`plugins/index.ts:325-347`](../../orchestrator/src/plugins/index.ts). **[W]**

**Tool namespacing and alias routing.** Plugin tools are advertised as `plugin_<id>_<toolName>`:
[`plugins/index.ts:350-395`](../../orchestrator/src/plugins/index.ts). A call may use the namespaced
name or a bare alias — `mcp/index.ts` finds a match by exact namespaced name or by `_<tool>` suffix —
and `callTool` resolves collisions by longest owning prefix:
[`mcp/index.ts:142-171`](../../orchestrator/src/mcp/index.ts),
[`plugins/index.ts:397-470`](../../orchestrator/src/plugins/index.ts). **[W]**

**JS MCP scaffolds.** A plugin without an MCP server of its own may ship a `scaffold` module that is
dynamically imported and called as `call(toolName, args, ctx)`. The `ctx` exposes `setting`,
`getOrCreateThread` (by tab name, creating under the first project), `addMessage` and `log`, and both
thread helpers emit on the bus so windows refresh:
[`plugins/index.ts:518-563`](../../orchestrator/src/plugins/index.ts). **[W]**

**Built-in DanyAPI plugin.** A `docker` plugin declaring six models and **two** MCP tools,
`ask_deepseek` and `ask_qwen`, with the scaffold seeded into the writable plugin directory at boot:
[`plugins/builtin.ts:96-144`](../../orchestrator/src/plugins/builtin.ts),
[`plugins/danyapi/plugin.json:17-45`](../../orchestrator/plugins/danyapi/plugin.json). The checked-in
scaffold is byte-identical to the embedded copy:
[`plugins/danyapi/mcp.js:1-79`](../../orchestrator/plugins/danyapi/mcp.js). **[W]**

---

## 6. MCP layer

**JSON-RPC endpoint.** `POST /mcp` parses the body, delegates to `mcpServer.handleJsonRpc`, and
answers `204` when the handler returns `null` (a notification); `GET` returns a ready string, and a
parse failure returns `-32700`:
[`index.ts:131-155`](../../orchestrator/src/index.ts). **[W]**

**Methods.** `initialize` (echoes the requested protocol version, advertises `tools`, `resources` and
`prompts` capabilities), `tools/list`, `tools/call`, `resources/list`, `resources/read`, and
`notifications/initialized` / `notifications/cancelled` which return `null` as JSON-RPC requires; the
default arm is `-32601`:
[`mcp/index.ts:90-245`](../../orchestrator/src/mcp/index.ts). **[W]**

**Resources.** Exactly two, `conclave://db/stats` (tab count) and `conclave://services/status`
(supervisor status); any other URI is `-32602`:
[`mcp/index.ts:174-235`](../../orchestrator/src/mcp/index.ts). **[W]** — `resources/templates/list`
and `prompts/list` are advertised as capabilities but **not implemented**, so a client that asks
receives `-32601`. **[P]**

**Built-in tools (four).** `run_command`, `read_file`, `write_file`, `get_service_status`, each with a
JSON input schema: [`mcp/index.ts:41-88`](../../orchestrator/src/mcp/index.ts). **[W]**

**Path containment.** `read_file` and `write_file` resolve against the root and reject anything that
does not `startsWith` it; `run_command` validates `cwd` the same way. `run_command` executes through
`sh -c`, captures stdout and stderr into a 10 MB buffer with a 30 s timeout, and merges them into one
text result:
[`mcp/index.ts:258-288`](../../orchestrator/src/mcp/index.ts),
[`mcp/index.ts:290-353`](../../orchestrator/src/mcp/index.ts). **[W] on POSIX, [P] on Windows** — `sh`
and `spawnSync('sh', …)` have no Windows equivalent, so four of the six advertised tools are inert
there.

**Containment root.** `this.rootDir = process.env.CONCLAVE_PROJECT_ROOT || process.cwd()`:
[`mcp/index.ts:37`](../../orchestrator/src/mcp/index.ts). **[S]** — nothing in the tree ever sets
`CONCLAVE_PROJECT_ROOT`, so the root is always the orchestrator's own working directory.

**Stdio bridges.** Two, both pass-throughs to the HTTP endpoint:

- [`bin/mcp-server.js:22-82`](../../orchestrator/bin/mcp-server.js) — readline over stdin, forwards
  each line with an explicit `Origin: http://127.0.0.1:4000`, suppresses replies to notifications,
  and maps both HTTP failure and connection refusal to a `-32000` JSON-RPC error. **[W]**
- [`crates/conclave-mcp/src/main.rs`](../../crates/conclave-mcp/src/main.rs) — a single-file,
  stdlib-only Rust twin compiled by bare `rustc`. It implements enough JSON parsing to locate a
  top-level `id` ([`main.rs:350-450`](../../crates/conclave-mcp/src/main.rs)), a hand-rolled HTTP/1.1
  client with `Connection: close` ([`main.rs:193-260`](../../crates/conclave-mcp/src/main.rs)), and
  chunked-transfer decoding ([`main.rs:290-330`](../../crates/conclave-mcp/src/main.rs)) because
  `Bun.serve` may omit `Content-Length`. It refuses `https` outright. **[W]**

---

## 7. Skills system

The tree ships seven prompt templates and a CommonJS registry loader. The templates are a
brainstorm prompt, a code review prompt, a long conversation-summarise prompt, a Tailwind 4
documentation pointer, a UI-reference/"premium design" prompt, a GitHub search prompt and a security
audit prompt:
[`skills/brainstorm.md`](../../skills/brainstorm.md), [`skills/code_review.md`](../../skills/code_review.md),
[`skills/convo_history_summarize.md`](../../skills/convo_history_summarize.md),
[`skills/frontend_tailwind.md`](../../skills/frontend_tailwind.md),
[`skills/get_ui_reference.md`](../../skills/get_ui_reference.md),
[`skills/github_search.md`](../../skills/github_search.md),
[`skills/security_audit.md`](../../skills/security_audit.md). **[S]**

The loader resolves a writable skills directory (env override, then a source checkout, then the OS
app-data candidates including a legacy `proxima` directory), seeds missing `.md` files into it,
extracts `${var}` names from each template, renders them, and returns the registry:
[`skills/skill-prompts.cjs:22-56`](../../skills/skill-prompts.cjs),
[`skills/skill-prompts.cjs:113-122`](../../skills/skill-prompts.cjs),
[`skills/skill-prompts.cjs:299-331`](../../skills/skill-prompts.cjs). **[S]**

**Nothing requires it.** `rg` for `skill-prompts`, `renderSkillPrompt` or `getSkillRegistrySummary`
across the tree matches only the module's own definitions, so the seven templates never reach a
model and the orchestrator has no skill surface at all. The loader is also actively wrong for this
tree: its source-checkout test looks for `electron/main-v2.cjs`, which exists only in Proxima:
[`skills/skill-prompts.cjs:124-127`](../../skills/skill-prompts.cjs). This is inherited Proxima code
(see the [comparison page](./proxima-comparison.md)), and its `PROXIMA_SKILLS_DIR` fallback is the
only lineage the tree admits to:
[`skills/skill-prompts.cjs:24-28`](../../skills/skill-prompts.cjs).

---

## 8. Sidecar and build pipeline

`build-sidecar.ts` runs at build time only and does four things: detect the host triple from
`rustc -Vv` unless `SIDECAR_TRIPLE` is set; `bun build --compile` the orchestrator into
`client/tauri/src-tauri/binaries/orchestrator-<triple>[.exe]`; `rustc -O` the Rust MCP bridge into
`conclave-mcp-<triple>[.exe]`; and copy the bridge next to its own source for local dev (warning loudly
on failure, deliberately not silently):
[`scripts/build-sidecar.ts:21-80`](../../scripts/build-sidecar.ts). **[W]**

The `.exe` suffix is added for Windows because bare `rustc -o <name>` writes the literal name:
[`scripts/build-sidecar.ts:33-40`](../../scripts/build-sidecar.ts).

**Tauri wiring.** `externalBin` names both sidecars, `build.rs` exports the triple-qualified
`ORCHESTRATOR_SIDECAR` env the loader reads, and `beforeDevCommand` chains the sidecar build with the
web dev server:
[`tauri.conf.json:49-55`](../../client/tauri/src-tauri/tauri.conf.json),
[`build.rs:1-8`](../../client/tauri/src-tauri/build.rs),
[`tauri.conf.json:7-10`](../../client/tauri/src-tauri/tauri.conf.json).

**Schema duplication.** The schema exists twice, once as `schema.sql` and once as a template string in
`schema.ts`, because a compiled sidecar cannot read the file; the header says to keep them in sync:
[`db/schema.ts:1-6`](../../orchestrator/src/db/schema.ts). The two are currently identical.

**Root scripts.** `dev`, `build`, `build:sidecar`, `web:dev`, `web:build`, `orchestrator:dev`,
`orchestrator:start`; the workspace package declares no dependencies at all:
[`package.json:6-15`](../../package.json).

---

## 9. Environment variables and the second divergence

Five `CONCLAVE_*` names are read anywhere:

| Variable | Read at | Set by |
|---|---|---|
| `CONCLAVE_DATA_DIR` | [`db/index.ts:10`](../../orchestrator/src/db/index.ts), [`bootstrap/index.ts:27`](../../orchestrator/src/bootstrap/index.ts), [`supervisor.ts:22`](../../orchestrator/src/processes/supervisor.ts), [`index.ts:266`](../../orchestrator/src/index.ts) | `orchestrator_loader.rs:82` in production |
| `CONCLAVE_ORCHESTRATOR_DIR` | [`orchestrator_loader.rs:46`](../../client/tauri/src-tauri/src/orchestrator_loader.rs) | nothing (manual override only) |
| `CONCLAVE_MCP_URL` | [`bin/mcp-server.js:14`](../../orchestrator/bin/mcp-server.js), [`crates/conclave-mcp/src/main.rs:18`](../../crates/conclave-mcp/src/main.rs) | nothing (manual override only) |
| `CONCLAVE_SKILLS_DIR` | [`skills/skill-prompts.cjs:24`](../../skills/skill-prompts.cjs) | nothing |
| `CONCLAVE_PROJECT_ROOT` | [`mcp/index.ts:37`](../../orchestrator/src/mcp/index.ts) | **nothing** — dead knob |

`PORT` overrides the orchestrator port as well ([`index.ts:12`](../../orchestrator/src/index.ts)).

The settings page's MCP paths were previously hard-coded development artefacts — a specific developer's
checkout path, repeated in the copied config, the Cursor instructions and the test command, plus a
platform-specific "open the config file" instruction. They are now derived at runtime and platform-aware,
so the copied MCP config names a path that exists on the running platform:
[`settings/+page.svelte`](../../client/web/src/routes/(desktop)/settings/+page.svelte).

**The rename is incomplete in the UI.** The sidebar still renders the pre-rename wordmark as three
spans, `br` + `AI` + `nstorm`:
[`Sidebar.svelte:159`](../../client/web/src/lib/components/Sidebar.svelte). `conclave` appears
nowhere in that header; the rename commit `1dd4aec` missed it.

---

## 10. The working / partial / stub ledger

This is the section the upgrade should plan from. Every entry names its evidence.

### Working (48)

Desktop shell (11): dual-window config, window-state persistence, move tracking, multi-monitor
clamping, overlay mode transition, overlay sizing clamps, always-on-top,
orchestrator side-load, WS transport with backoff/queue/reconnect, dynamic CORS + origin guard.
Web client (14): routing groups, the harness store, the socket bridge with cross-window coalescing,
sidebar + top-6 + show-all, thread menu (rename/archive/export/delete), tabs strip, new-chat modal,
markdown + highlight.js + code collapse/copy, `<think>` blocks, long-message clamp, scroll behaviour,
sort order, token display, prompt dock, attachments.
Orchestrator (14): `Bun.serve`, handshake, all fourteen WS message types, streaming fan-out +
`TAB_UPDATED`, broadcast, provider-session delete, the nine-table store + repos, Base58 ids,
migrations/seed, provider abstraction, DanyAPI stream adapter, the router, supervisor, bootstrap,
plugin engine (all three types), plugin lifecycle, namespacing/alias routing, JS scaffolds, built-in
DanyAPI plugin.
MCP (5): `/mcp` endpoint, all implemented methods, two resources, four built-ins, path containment,
and both stdio bridges.
Build (4): orchestrator compile, Rust bridge compile, dev-binary copy, Tauri wiring.
Overlay (6): the state machine, prompt handoff, 60 s guard, response countdown, resize grip, handback.

Grouped exactly: **48 working**.

### Partial (10)

1. Provider selection is cosmetic — every name routes to DanyAPI,
   [`providers/index.ts:18-24`](../../orchestrator/src/providers/index.ts).
2. `availableModels` carries Claude entries nothing can serve —
   [`harness.svelte.ts:90-98`](../../client/web/src/lib/stores/harness.svelte.ts).
3. Settings Engine tab is static text with a fake live badge —
   [`settings/+page.svelte:776-792`](../../client/web/src/routes/(desktop)/settings/+page.svelte).
4. Settings MCP tab hard-codes "6 tools" and a personal dev path —
   [`settings/+page.svelte:269`](../../client/web/src/routes/(desktop)/settings/+page.svelte),
   [`settings/+page.svelte:36`](../../client/web/src/routes/(desktop)/settings/+page.svelte).
5. `run_command`/`read_file`/`write_file` are `sh`-based and inert on Windows —
   [`mcp/index.ts:265`](../../orchestrator/src/mcp/index.ts).
6. `prompts/list` and `resources/templates/list` are advertised and unimplemented —
   [`mcp/index.ts:112-116`](../../orchestrator/src/mcp/index.ts).
7. Theming is a single hard-coded dark palette with no token layer —
   [`app.css:1-19`](../../client/web/src/app.css).
8. `service_state` is written on every status change and never read —
   written at [`supervisor.ts:264-266`](../../orchestrator/src/processes/supervisor.ts), and
   `getStatus` reads the in-memory map instead
   ([`supervisor.ts:247-260`](../../orchestrator/src/processes/supervisor.ts)).
9. The `uploads` table is written and never read —
   [`index.ts:328-332`](../../orchestrator/src/index.ts) is the only reference.
10. CSP is disabled (`"csp": null`) while `withGlobalTauri` is on —
    [`tauri.conf.json:45-47`](../../client/tauri/src-tauri/tauri.conf.json),
    [`tauri.conf.json:14`](../../client/tauri/src-tauri/tauri.conf.json).

### Stub or dead (9)

1. **The skills system.** Seven templates and a full loader, required by nothing; its
   source-checkout test looks for an Electron file this tree does not have —
   [`skills/skill-prompts.cjs:124-127`](../../skills/skill-prompts.cjs).
2. **`LocalMockProvider`.** Exported, imported by the router, and returned by no code path;
   `getProvider` cannot reach it — [`providers/mock.ts:3-37`](../../orchestrator/src/providers/mock.ts),
   [`router/index.ts:2`](../../orchestrator/src/router/index.ts) (unused import).
3. **The tool-step pipeline.** `TOOL_STEP_UPDATE` is handled by the client
   ([`orchestratorSocket.svelte.ts:161-196`](../../client/web/src/lib/services/orchestratorSocket.svelte.ts))
   and `tool_step` is a declared chunk type
   ([`providers/types.ts:2-6`](../../orchestrator/src/providers/types.ts)), but no real provider ever
   yields one: DanyAPI yields only `token` and `usage`
   ([`danyapi.ts:142-157`](../../orchestrator/src/providers/danyapi.ts)), and the mock does not either.
   The `tool_steps` table, the WS message and `ToolStepPill` are therefore all fed by nothing on the
   real path.
4. **`SvelteKit /api/chat`.** A canned-response generator that matches on `linear|bug|issue`,
   `fix|edit|code` and `pr|pull request|git`, then streams invented Linear tickets (WEB-476), a fake
   diff and a fake PR #494 word by word:
   [`api/chat/+server.ts:55-170`](../../client/web/src/routes/api/chat/+server.ts). The harness falls
   back to it only when the socket is down
   ([`harness.svelte.ts:784-800`](../../client/web/src/lib/stores/harness.svelte.ts)).
5. **`SvelteKit /api/providers`.** Returns six providers, four of which nothing can reach:
   [`api/providers/+server.ts:4-72`](../../client/web/src/routes/api/providers/+server.ts).
   Both (4) and (5) are unreachable in a shipped build: the app is `prerender = true` under
   `adapter-static` with `strict: false`, so no server route survives into `build/`.
6. **`ask_zai`.** The DanyAPI scaffold branches for it and both copies of the comment advertise it
   ([`plugins/builtin.ts:15`](../../orchestrator/src/plugins/builtin.ts),
   [`plugins/danyapi/mcp.js:14-16`](../../orchestrator/plugins/danyapi/mcp.js)), but it is not in the
   declared `mcp.tools` list ([`builtin.ts:106-133`](../../orchestrator/src/plugins/builtin.ts)), so
   `callTool`'s `owns` check never matches and `tools/list` never advertises it. Calling
   `plugin_danyapi_ask_zai` falls through to `Unknown plugin tool`.
7. **`CONCLAVE_PROJECT_ROOT`.** Read, never written
   ([`mcp/index.ts:37`](../../orchestrator/src/mcp/index.ts)).
8. **`INITIAL_PROVIDERS`.** Six provider cards with invented endpoints, models and latencies, one of
   which (`vllm`) is pre-marked offline:
   [`harness.svelte.ts:4-76`](../../client/web/src/lib/stores/harness.svelte.ts).
9. **The `bun` plugin type has no instance.** The code path is complete, but no built-in or checked-in
   plugin uses it, so it is unexercised.
10. **The voice-input button.** A styled button with an accessible title and no handler at all —
    [`PromptInput.svelte:345-352`](../../client/web/src/lib/components/PromptInput.svelte).

### Summary

| State | Count |
|---|---|
| Working | 48 |
| Partial | 10 |
| Stub or dead | 10 |
| **Total inventoried** | **68** |

The two facts that matter most for the upgrade: **the skills system is entirely inert** (the tree's
seven prompt templates reach no model), and **the tool-step UI has no producer on the real path** —
the orchestrator never emits `tool_step`, so every pill a user could see today comes from the fake
`/api/chat` route in a dev build. Everything else in the "stub" column is a smaller, local problem.

---

## Related

- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — what the tree is, the
  DanyAPI version skew, and the env-var readers
- [Conclave dependency audit](./conclave-dependency-audit.md) — every declared dependency measured
  against the live registries
- [Conclave versus Proxima](./proxima-comparison.md) — the feature-by-feature gap list this inventory
  feeds
- [Project documentation map](./index.md) — the map this page hangs from
