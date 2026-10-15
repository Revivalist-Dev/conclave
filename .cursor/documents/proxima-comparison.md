---
title: Conclave versus Proxima — feature-by-feature comparison
topic: conclave-proxima-comparison
updated: 2026-10-15
status: current
---

# Conclave versus Proxima — feature-by-feature comparison

Conclave is the tool that supersedes Proxima. This page compares the two by reading both trees:
Conclave at `.agent-repositories/conclave`, Proxima at `.agent-repositories/Proxima-main`
(`Zen4-bit/Proxima` v5.0.0, 357 files). Proxima the application was uninstalled on 2026-10-15, so this
checkout is a **cross-comparison reference and nothing here runs**; every Proxima claim below is read
out of its source, not out of its README.

Conclave's own inventory, with the working/partial/stub split per feature, is
[its own page](./features.md); this page assumes it.

The brief this page was written from listed Proxima's surface from memory. Three of its items need
correcting before the table, because each would misdirect the upgrade:

- **"An SQLite skills database" is wrong.** Proxima's skills are Markdown files on disk, one per
  skill, with a directory scan and a `used` counter for ordering:
  [`electron/api/byok/brain/skills.cjs:11`](../../../Proxima-main/electron/api/byok/brain/skills.cjs),
  `:106-108`, `:185-208`. What Proxima actually keeps in SQLite is **conversation and vector memory**:
  `sessions.db` holding a `sessions` and a `chunks` table
  ([`sessions.cjs:10`](../../../Proxima-main/electron/api/byok/brain/sessions.cjs), `:40`, `:49`), and a
  separate `vault.db` for the Python recall vault
  ([`proxima-agent/proxima_agent/recall/vault.py:8`](../../../Proxima-main/proxima-agent/proxima_agent/recall/vault.py), `:24`).
- **The `ask_*` family is six tools, but the surface is eight.** Beyond
  `ask_chatgpt`/`ask_claude`/`ask_gemini`/`ask_perplexity`/`ask_model`/`ask_all_ais`
  (all in [`src/mcp/tools-chat.js`](../../../Proxima-main/src/mcp/tools-chat.js)) there are
  `smart_query` (`:217`) and `new_conversation` (`:252`).
- **"40 MCP tools" is accurate.** `registerTool` appears 40 times across the six `tools-*.js`
  modules. The brief's control-tool list is also accurate as written: `clear_cache`,
  `show_window`, `hide_window`, `toggle_window`, `set_headless_mode`
  ([`tools-utility.js:18`](../../../Proxima-main/src/mcp/tools-utility.js), `:147`, `:157`, `:167`, `:177`),
  and `run_workflow`, `run_loop`, `crew`, `proxima_cost_report`, `proxima_agentic_status`
  ([`tools-workflow.js:21`](../../../Proxima-main/src/mcp/tools-workflow.js), `:53`, `:81`, `:141`, `:162`).

---

## 1. The comparison

One row per capability. `conclave` and `Proxima` columns name the state or the `file:line` that
proves it; **stub** means the code exists but no real path executes it.

| Capability | Conclave | Proxima | Verdict |
|---|---|---|---|
| Desktop shell | Tauri v2, dual webview ([`lib.rs:1-412`](../../client/tauri/src-tauri/src/lib.rs)) | Electron main process ([`main-v2.cjs`](../../../Proxima-main/electron/main-v2.cjs)) | both |
| Ambient HUD overlay window with a five-state machine | [`overlay/+page.svelte:37`](../../client/web/src/routes/overlay/+page.svelte) | none | conclave only |
| Cross-window tab handover between the HUD and the main window | [`lib.rs:205-236`](../../client/tauri/src-tauri/src/lib.rs) | none | conclave only |
| Window state persisted to a config file | `~/.conclave.json` ([`lib.rs:47-148`](../../client/tauri/src-tauri/src/lib.rs)) | Electron window state via IPC ([`ipc/core.cjs`](../../../Proxima-main/electron/ipc/core.cjs)) | both |
| Multi-monitor off-screen clamping | [`lib.rs:56-112`](../../client/tauri/src-tauri/src/lib.rs) | not found | conclave only |
| Show / hide / toggle window and headless mode as MCP tools | none | [`tools-utility.js:147-187`](../../../Proxima-main/src/mcp/tools-utility.js) | Proxima only |
| System tray icon | none | none | neither |
| Local OpenAI-compatible LLM container (Docker) | DanyAPI on :8000, supervised ([`supervisor.ts:114-177`](../../orchestrator/src/processes/supervisor.ts)) | none | conclave only |
| Container lifecycle supervision and log tailing | [`supervisor.ts:179-233`](../../orchestrator/src/processes/supervisor.ts) | none | conclave only |
| Browser-session providers (stealth ChatGPT / Claude / Gemini / Perplexity) | none | [`browser-manager.cjs`](../../../Proxima-main/electron/browser-manager.cjs) + four engines ([`engines/`](../../../Proxima-main/electron/providers/engines)) | Proxima only |
| BYOK providers (OpenAI / Anthropic / Google / Perplexity / OpenAI-compatible) | none | [`byok/providers/`](../../../Proxima-main/electron/api/byok/providers) (5 adapters) | Proxima only |
| Provider selection actually routes to the chosen backend | no — every name returns DanyAPI ([`providers/index.ts:18-24`](../../orchestrator/src/providers/index.ts)) | yes — capability + latency routing ([`smart-router.js:47`](../../../Proxima-main/src/agentic/smart-router.js)) | Proxima only |
| Multi-provider query tools (`ask_*` family) | two (`ask_deepseek`, `ask_qwen`) ([`builtin.ts:106-133`](../../orchestrator/src/plugins/builtin.ts)) | eight, incl. `ask_all_ais` ([`tools-chat.js:155`](../../../Proxima-main/src/mcp/tools-chat.js)) | Proxima only |
| Auto-routed single query | no | `smart_query` ([`tools-chat.js:217`](../../../Proxima-main/src/mcp/tools-chat.js)) | Proxima only |
| Chat UI with projects, tabs and message history | [`Sidebar.svelte`](../../client/web/src/lib/components/Sidebar.svelte), [`harness.svelte.ts:81-806`](../../client/web/src/lib/stores/harness.svelte.ts) | Electron renderer + FastAPI web console ([`web/static/app.js`](../../../Proxima-main/proxima-agent/proxima_agent/web/static/app.js)) | both |
| Thread archive | [`harness.svelte.ts:563-572`](../../client/web/src/lib/stores/harness.svelte.ts) | none | conclave only |
| Thread export to Markdown | [`harness.svelte.ts:576-600`](../../client/web/src/lib/stores/harness.svelte.ts) | none | conclave only |
| First-6 threads with show-all expansion | [`Sidebar.svelte:285`](../../client/web/src/lib/components/Sidebar.svelte) | not found | conclave only |
| Reasoning `<think>` rendering, code collapse and copy | [`ConversationView.svelte:9-179`](../../client/web/src/lib/components/ConversationView.svelte) | none found in the renderer | conclave only |
| Per-message token accounting | SQLite `messages.usage`, shown per turn ([`harness.svelte.ts:687-691`](../../client/web/src/lib/stores/harness.svelte.ts)) | [`src/cost/token-tracker.js`](../../../Proxima-main/src/cost/token-tracker.js) | both |
| Cost report as a tool | no | `proxima_cost_report` ([`tools-workflow.js:141`](../../../Proxima-main/src/mcp/tools-workflow.js)) | Proxima only |
| Conversation persisted in SQLite | `conclave.db`, 9 tables ([`db/schema.ts:6-98`](../../orchestrator/src/db/schema.ts)) | `sessions.db` ([`sessions.cjs:40-60`](../../../Proxima-main/electron/api/byok/brain/sessions.cjs)) | both |
| Vector / semantic memory with ONNX embeddings | none | [`brain/embeddings.cjs:110`](../../../Proxima-main/electron/api/byok/brain/embeddings.cjs) | Proxima only |
| Memory decay and automatic fact harvesting | none | [`memory-intelligence.js`](../../../Proxima-main/src/memory/memory-intelligence.js) + `enhanced-memory.json` ([`enhanced-memory.js:8`](../../../Proxima-main/src/agentic/enhanced-memory.js)) | Proxima only |
| Cross-session conversation recall vault | none | [`recall/vault.py:109`](../../../Proxima-main/proxima-agent/proxima_agent/recall/vault.py) | Proxima only |
| Prompt-template skills | seven `.md` templates, **dead** ([`skill-prompts.cjs:124-127`](../../skills/skill-prompts.cjs)) | `.md` skills on disk, live ([`skills.cjs:185-208`](../../../Proxima-main/electron/api/byok/brain/skills.cjs)) | both (stub in Conclave) |
| MCP server over stdio | two bridges, JS and Rust ([`bin/mcp-server.js`](../../orchestrator/bin/mcp-server.js), [`crates/conclave-mcp/src/main.rs`](../../crates/conclave-mcp/src/main.rs)) | SDK server ([`src/mcp/index.js`](../../../Proxima-main/src/mcp/index.js)) | both |
| MCP tool count | 4 built-ins + 2 plugin tools ([`mcp/index.ts:41-88`](../../orchestrator/src/mcp/index.ts)) | 40 ([`tools-*.js`](../../../Proxima-main/src/mcp)) | Proxima only (breadth) |
| MCP resources | two (`conclave://db/stats`, `conclave://services/status`) ([`mcp/index.ts:174-235`](../../orchestrator/src/mcp/index.ts)) | none registered | conclave only |
| Install an MCP plugin from a git URL at runtime | [`plugins/index.ts:265-292`](../../orchestrator/src/plugins/index.ts) | none | conclave only |
| Plugin enable / disable / remove with a UI | [`plugins/index.ts:300-347`](../../orchestrator/src/plugins/index.ts), [`settings/+page.svelte:663-765`](../../client/web/src/routes/(desktop)/settings/+page.svelte) | none | conclave only |
| Provider models declared by a plugin and surfaced to the UI | [`harness.svelte.ts:368-378`](../../client/web/src/lib/stores/harness.svelte.ts) | none (providers are built in) | conclave only |
| Sequential multi-step workflow engine | none | `run_workflow` ([`tools-workflow.js:21`](../../../Proxima-main/src/mcp/tools-workflow.js)) | Proxima only |
| Iterate-to-convergence loop | none | `run_loop` ([`tools-workflow.js:53`](../../../Proxima-main/src/mcp/tools-workflow.js)) | Proxima only |
| Role-based multi-agent crew | none | `crew` ([`tools-workflow.js:81`](../../../Proxima-main/src/mcp/tools-workflow.js)) | Proxima only |
| Smart task router with EMA latency and provider isolation | none | [`smart-router.js:47`](../../../Proxima-main/src/agentic/smart-router.js), `:185` | Proxima only |
| Documentation middleware (Context7) | none | [`context7-middleware.js`](../../../Proxima-main/src/agentic/context7-middleware.js) | Proxima only |
| Symbol-mapped codebase analysis and smart slicing | none | [`symbol-extractor.js`](../../../Proxima-main/src/utils/symbol-extractor.js), [`smart-slicer.js`](../../../Proxima-main/src/utils/smart-slicer.js) | Proxima only |
| Codebase packing and content grep | none | [`codebase-packer.js`](../../../Proxima-main/src/utils/codebase-packer.js) | Proxima only |
| Generated-code review / optimize / explain / convert / verify / test tools | none | 12 tools in [`tools-code.js`](../../../Proxima-main/src/mcp/tools-code.js) | Proxima only |
| Content tools (generate / compare / debate / verify) | none | 4 tools in [`tools-content.js`](../../../Proxima-main/src/mcp/tools-content.js) | Proxima only |
| Search tools (DDG / deep research / web scrape / UI reference) | none | 4 tools in [`tools-search.js`](../../../Proxima-main/src/mcp/tools-search.js) | Proxima only |
| Autonomous browser control over CDP | none | [`tools/browser_cdp.py:474`](../../../Proxima-main/proxima-agent/proxima_agent/tools/browser_cdp.py) | Proxima only |
| Desktop automation (mouse / keyboard / windows) | none | [`tools/computer/`](../../../Proxima-main/proxima-agent/proxima_agent/tools/computer), [`tools/desktop/_windows.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/desktop/_windows.py) | Proxima only |
| OCR | none | [`tools/ocr.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/ocr.py) | Proxima only |
| Self-healing debug loop with learned fixes | none | [`self_heal.py:49`](../../../Proxima-main/proxima-agent/proxima_agent/tools/self_heal.py), [`learned_fixes.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/learned_fixes.py) | Proxima only |
| Gated execution safety modes | none | `FULL_AUTO` / `SMART` / `SUGGEST` ([`permissions.py:10-13`](../../../Proxima-main/proxima-agent/proxima_agent/permissions.py)), [`gate.py:12`](../../../Proxima-main/proxima-agent/proxima_agent/gate.py) | Proxima only |
| Sandboxed code-execution worker | none | [`tools/execute.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/execute.py), [`_exec_worker.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/_exec_worker.py) | Proxima only |
| Git operations as tools | none | [`tools/coding/git_ops.py:34-81`](../../../Proxima-main/proxima-agent/proxima_agent/tools/coding/git_ops.py) | Proxima only |
| OpenAI-compatible REST API for external clients | no — HTTP is internal only | [`rest-api.cjs:20`](../../../Proxima-main/electron/api/rest-api.cjs) on :3210 | Proxima only |
| WebSocket gateway for external clients | no — the socket serves its own UI | [`ws-server.cjs`](../../../Proxima-main/electron/api/ws-server.cjs) | Proxima only |
| CLI | none | [`cli/proxima-cli.cjs`](../../../Proxima-main/cli/proxima-cli.cjs) | Proxima only |
| Language SDKs | none | [`sdk/proxima.js`](../../../Proxima-main/sdk/proxima.js), [`sdk/proxima.py`](../../../Proxima-main/sdk/proxima.py) | Proxima only |
| Auto-update | none | `electron-updater` ([`package.json`](../../../Proxima-main/package.json)) | Proxima only |
| Test suite | **none** | 90+ files under [`tests/`](../../../Proxima-main/tests) | Proxima only |
| Multi-turn session continuity via a server-side session id | `tab_id` as `session_id` ([`danyapi.ts:84`](../../orchestrator/src/providers/danyapi.ts)) | session store ([`sessions.cjs`](../../../Proxima-main/electron/api/byok/brain/sessions.cjs)) | both |
| Attachment staging for multimodal prompts | `POST /api/upload` → DanyAPI `/v1/files` ([`index.ts:244-380`](../../orchestrator/src/index.ts)) | `buildMessageWithFiles` ([`mcp/helpers.js`](../../../Proxima-main/src/mcp/helpers.js)) | both |
| Voice input | button exists, no handler ([`PromptInput.svelte:345-352`](../../client/web/src/lib/components/PromptInput.svelte)) | not found | neither |
| Production sidecar packaging with a data-dir contract | `build-sidecar.ts` + `CONCLAVE_DATA_DIR` ([`build-sidecar.ts:42-64`](../../scripts/build-sidecar.ts)) | Electron asar + wheel build ([`scripts/build-wheel.cjs`](../../../Proxima-main/scripts/build-wheel.cjs)) | both |

---

## 2. What Proxima has that Conclave does not (the upgrade list)

Twenty-six capabilities. This is the list the comprehensive upgrade runs from; ordered by how much
architectural work each implies, largest first.

1. **Provider abstraction that actually routes.** Conclave has the interface and one implementation;
   Proxima has five BYOK adapters plus four browser-session engines, and a router that picks between
   them. Conclave: [`providers/index.ts:18-24`](../../orchestrator/src/providers/index.ts) returns
   DanyAPI for every input. Proxima: [`byok/providers/`](../../../Proxima-main/electron/api/byok/providers),
   [`browser-manager.cjs`](../../../Proxima-main/electron/browser-manager.cjs).
2. **Browser-session providers.** Four stealth engines driving a real logged-in browser:
   [`engines/chatgpt-engine.js`](../../../Proxima-main/electron/providers/engines/chatgpt-engine.js),
   `claude-engine.js`, `gemini-engine.js`, `perplexity-engine.js`. Nothing comparable in Conclave.
3. **BYOK API-key providers.** [`byok/keys.cjs`](../../../Proxima-main/electron/api/byok/keys.cjs),
   [`byok/providers/`](../../../Proxima-main/electron/api/byok/providers),
   [`byok/model-fetcher.cjs`](../../../Proxima-main/electron/api/byok/model-fetcher.cjs) (live model
   lists per provider).
4. **A multi-provider ask surface.** Eight chat tools against Conclave's two:
   [`tools-chat.js`](../../../Proxima-main/src/mcp/tools-chat.js).
5. **Smart routing.** Capability profiles, EMA latency, and a 60-second isolation on three consecutive
   failures: [`smart-router.js:47`](../../../Proxima-main/src/agentic/smart-router.js), `:185`.
6. **Agentic workflows.** Sequential pipeline, iterate-to-convergence loop, and role-based crew:
   [`tools-workflow.js:21`](../../../Proxima-main/src/mcp/tools-workflow.js), `:53`, `:81`;
   [`workflow-engine.js`](../../../Proxima-main/src/agentic/workflow-engine.js),
   [`run-loop.js`](../../../Proxima-main/src/agentic/run-loop.js).
7. **Vector memory.** ONNX embeddings, mean pooling and a chunk store:
   [`brain/embeddings.cjs:110`](../../../Proxima-main/electron/api/byok/brain/embeddings.cjs),
   [`brain/sessions.cjs:49`](../../../Proxima-main/electron/api/byok/brain/sessions.cjs).
8. **Cross-session recall vault.** A second SQLite store for prior conversation recall:
   [`recall/vault.py:109`](../../../Proxima-main/proxima-agent/proxima_agent/recall/vault.py).
9. **Memory decay and fact harvesting.** [`memory-intelligence.js`](../../../Proxima-main/src/memory/memory-intelligence.js)
   with a 7-day half-life, and [`enhanced-memory.js:8`](../../../Proxima-main/src/agentic/enhanced-memory.js).
10. **Symbol-mapped codebase analysis.** [`symbol-extractor.js`](../../../Proxima-main/src/utils/symbol-extractor.js),
    [`smart-slicer.js`](../../../Proxima-main/src/utils/smart-slicer.js) (`buildSymbolMap`,
    `sliceBySymbols`), [`codebase-packer.js`](../../../Proxima-main/src/utils/codebase-packer.js),
    [`file-tree.js`](../../../Proxima-main/src/utils/file-tree.js).
11. **Code-intelligence tools.** Twelve: solve, fix_error, build_architecture, write_tests,
    explain_error, convert_code, security_audit, verify_code, explain_code, generate_code,
    optimize_code, review_code ([`tools-code.js`](../../../Proxima-main/src/mcp/tools-code.js)).
12. **Content tools.** generate, compare, debate, verify:
    [`tools-content.js`](../../../Proxima-main/src/mcp/tools-content.js).
13. **Search and scrape tools.** DDG search, deep research, web scrape, UI reference:
    [`tools-search.js`](../../../Proxima-main/src/mcp/tools-search.js).
14. **Autonomous browser control over CDP.** A full `ChromeBrowser` class:
    [`tools/browser_cdp.py:474`](../../../Proxima-main/proxima-agent/proxima_agent/tools/browser_cdp.py).
15. **Desktop automation and computer use.** Mouse, keyboard and window control:
    [`tools/computer/`](../../../Proxima-main/proxima-agent/proxima_agent/tools/computer).
16. **OCR.** [`tools/ocr.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/ocr.py)
    (`pytesseract`, declared at
    [`pyproject.toml:16`](../../../Proxima-main/proxima-agent/pyproject.toml)).
17. **Self-healing debug loop with a learned-fix store.**
    [`self_heal.py:49`](../../../Proxima-main/proxima-agent/proxima_agent/tools/self_heal.py),
    [`learned_fixes.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/learned_fixes.py),
    [`retry.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/retry.py).
18. **Gated execution safety modes.** `FULL_AUTO` / `SMART` / `SUGGEST` with a risk-scoring pattern
    table: [`permissions.py:10-31`](../../../Proxima-main/proxima-agent/proxima_agent/permissions.py),
    [`gate.py:12`](../../../Proxima-main/proxima-agent/proxima_agent/gate.py).
19. **A sandboxed execution worker.** [`tools/execute.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/execute.py),
    [`_exec_worker.py`](../../../Proxima-main/proxima-agent/proxima_agent/tools/_exec_worker.py).
20. **Documentation middleware.** [`context7-middleware.js`](../../../Proxima-main/src/agentic/context7-middleware.js)
    with a TTL cache, invoked from the pipeline (declared at
    [`src/mcp/index.js:31`](../../../Proxima-main/src/mcp/index.js)).
21. **An OpenAI-compatible REST API.** [`rest-api.cjs:20`](../../../Proxima-main/electron/api/rest-api.cjs)
    on :3210, with `/v1/models`, `/v1/stats` and an OpenAPI document
    ([`docs/openapi.json`](../../../Proxima-main/docs/openapi.json)).
22. **A WebSocket gateway for external clients.** [`ws-server.cjs`](../../../Proxima-main/electron/api/ws-server.cjs).
23. **A CLI.** [`cli/proxima-cli.cjs`](../../../Proxima-main/cli/proxima-cli.cjs).
24. **SDKs.** [`sdk/proxima.js`](../../../Proxima-main/sdk/proxima.js) and
    [`sdk/proxima.py`](../../../Proxima-main/sdk/proxima.py).
25. **Auto-update.** `electron-updater` in [`package.json`](../../../Proxima-main/package.json).
26. **A test suite.** 90+ files under [`tests/`](../../../Proxima-main/tests), spanning the agentic
    modules, the BYOK layer, the MCP tools and the Python tools. Conclave has **no tests at all**;
    the four `package.json` files declare a `test` script only in the orchestrator
    ([`orchestrator/package.json:9`](../../orchestrator/package.json)), and no test file exists.

---

## 3. What Conclave has that Proxima does not

Nine capabilities, each with the `file:line` on the Conclave side.

1. **A native desktop shell instead of Electron**, with two windows and a real ambient HUD:
   [`lib.rs:9-412`](../../client/tauri/src-tauri/src/lib.rs).
2. **The ambient overlay.** A five-state floating HUD with a 60-second thinking guard, an
   auto-dismissing response card and cross-window tab handover:
   [`overlay/+page.svelte:37`](../../client/web/src/routes/overlay/+page.svelte),
   [`lib.rs:205-236`](../../client/tauri/src-tauri/src/lib.rs).
3. **Multi-monitor off-screen clamping** for both windows:
   [`lib.rs:56-112`](../../client/tauri/src-tauri/src/lib.rs).
4. **A macOS Spaces integration** putting the HUD on all Spaces above fullscreen apps:
   [`lib.rs:114-127`](../../client/tauri/src-tauri/src/lib.rs).
5. **A plugin engine** that installs MCP servers from a git URL, namespaces their tools, health-checks
   process plugins, and loads JS scaffolds for backends that have no MCP server:
   [`plugins/index.ts:265-292`](../../orchestrator/src/plugins/index.ts),
   [`plugins/index.ts:350-470`](../../orchestrator/src/plugins/index.ts),
   [`plugins/index.ts:518-563`](../../orchestrator/src/plugins/index.ts).
6. **A plugin management UI** with status, tool counts, enable and remove:
   [`settings/+page.svelte:663-765`](../../client/web/src/routes/(desktop)/settings/+page.svelte).
7. **MCP resources** on the orchestrator endpoint:
   [`mcp/index.ts:174-235`](../../orchestrator/src/mcp/index.ts).
8. **Container supervision** with `docker compose up -d`, a live log streamer and a health poll:
   [`supervisor.ts:114-233`](../../orchestrator/src/processes/supervisor.ts).
9. **Thread-level chat ergonomics** Proxima does not have: archive, Markdown export, first-6 with
   show-all, `<think>` rendering with collapsible code blocks, and a token badge per turn:
   [`harness.svelte.ts:563-600`](../../client/web/src/lib/stores/harness.svelte.ts),
   [`Sidebar.svelte:285`](../../client/web/src/lib/components/Sidebar.svelte),
   [`ConversationView.svelte:9-179`](../../client/web/src/lib/components/ConversationView.svelte).

---

## 4. How to read the gap list

The shape of the two trees is different, and the upgrade should not try to close the list item by
item. Proxima is a **model-access and autonomous-agent platform**: its value is in routing between
many providers and in acting on a machine. Conclave is a **desktop chat harness with an ambient HUD**:
its value is in the shell, the overlay, the plugin engine and the container supervision, none of which
Proxima has.

Three observations that should shape the sequencing:

- **The highest-leverage gap is item 1.** Everything else in the Proxima column depends on the
  provider layer actually routing. Conclave has the interface
  ([`providers/types.ts:1-46`](../../orchestrator/src/providers/types.ts)) and the registry shape, and
  a plugin manifest already declares models that reach the UI
  ([`harness.svelte.ts:368-378`](../../client/web/src/lib/stores/harness.svelte.ts)), so a second
  adapter is the smallest change that unlocks the largest surface.
- **The skills system is shared ground, already designed, and dead in Conclave.** Both trees keep
  skills as `.md` files. Proxima's loader works
  ([`skills.cjs:185-208`](../../../Proxima-main/electron/api/byok/brain/skills.cjs)); Conclave's
  ([`skill-prompts.cjs`](../../skills/skill-prompts.cjs)) is unreferenced and its checkout test looks
  for a file Conclave does not have. Reviving it against Proxima's loader is a small task with a
  bounded surface.
- **The agentic layer (items 6, 17, 18) is where the two trees diverge in kind, not degree.** Bringing
  `run_workflow` / `run_loop` / `crew` and a permission gate into Conclave means adding an execution
  model Conclave does not have today, not porting a module. It should be planned as its own milestone,
  after the provider layer, and it should reuse Proxima's designs rather than re-derive them
  (see [the upstream-reuse rule](../../../../.cursor/rules/30-upstream-reuse.mdc)).

---

## Related

- [Conclave — complete feature inventory](./features.md) — the working / partial / stub split per
  Conclave feature, with the two doc-vs-code divergences
- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — what the tree is, and the
  DanyAPI fork coupling that item 1 also has to resolve
- [Project documentation map](./index.md) — the map this page hangs from
