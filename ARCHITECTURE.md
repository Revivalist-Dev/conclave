# Architecture: Conclave

**Conclave** is a modular, high-performance, and lightweight local AI agentic coding and chat harness. It couples a native desktop shell (Tauri v2) with a reactive SvelteKit 5 web frontend, a centralized Bun/TypeScript orchestrator with native SQLite persistence, and containerized local LLM backends (DanyAPI on Docker).

The system is designed with strict separation of concerns, zero host script pollution, native multi-turn session continuation, and an edge-to-edge frameless user interface.

---

### 1. High-Level Architecture

```
+---------------------------------------------------------------------------------------------------+
|                                           CLIENT LAYER                                            |
|                                                                                                   |
|   +--------------------------------------------------+          +-----------------------------+   |
|   |                client/tauri (v2)                 |          |         client/web          |   |
|   |  Native desktop shell (Win/Linux)                |          | SvelteKit 5 + Tailwind CSS  |   |
|   |  - Dual-window (Main chat + Ambient overlay)     |          | - Reactive runes store      |   |
|   |  - Native WS Transport (orchestrator_ws.rs)      |<---------| - IPC bridge: ws_send,      |   |
|   |    • Single persistent connection to :4000/ws    | events:  |   orchestrator-message,     |   |
|   |    • Capped backoff & offline queue (64 msgs)    | status,  |   orchestrator-status       |   |
|   |  - Process Supervisor (orchestrator_loader.rs)   | message  | - Window drag & HUD controls|   |
|   |    • Spawns & lifecycle-manages Bun orchestrator |--------->|                             |   |
|   |    • Graceful SIGTERM with timeout before kill   |          +--------------+--------------+   |
|   +-------------------------+------------------------+                         |                  |
|                             |                                                  |                  |
|                             | Persistent WebSocket (Native)                    | Multipart Staging|
|                             | ws://127.0.0.1:4000/ws                           | /api/upload      |
|                             v                                                  v                  |
+--------------------------------------------------------------------------------+------------------+
                              |                                                  |
                              +─────────────────────────┬────────────────────────┘
                                                        v
+---------------------------------------------------------------------------------------------------+
|                                        ORCHESTRATOR LAYER                                         |
|                                         (TypeScript / Bun)                                        |
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                               HTTP Server & WebSocket Hub                                 |   |
|   |   - ws://127.0.0.1:4000/ws         : Real-time token streaming, tabs, & tool steps        |   |
|   |   - POST /api/upload               : File staging & DanyAPI forwarder                     |   |
|   |   - POST /mcp                      : Model Context Protocol JSON-RPC 2.0 (Confined Root)  |   |
|   |   - GET /api/tabs, /api/settings   : Canonical REST state endpoints                       |   |
|   |   - GET /health                    : Supervisor telemetry & Docker engine metrics         |   |
|   |   - Origin Validation              : Strict localhost & tauri:// filtering (blocks CSRF) |   |
|   +-------------------+-----------------------------+-----------------------------+-----------+   |
|                       |                             |                             |               |
|                       v                             v                             v               |
|   +-----------------------------------+ +-----------------------+ +---------------------------+   |
|   |          SQLite Database          | |      LLM Router       | |       Plugin System       |   |
|   |           (bun:sqlite)            | | - Tab session binding | | (plugins/ & McpStdioClient|   |
|   | - Projects, tabs (Base58 IDs)     | | - Provider adapters   | | - Dynamic MCP tool pass-  |   |
|   | - Messages, tool steps, uploads   | | - Error delta yielding| |   through & git installs  |   |
|   | - Settings & Plugins registry     | | - Token accounting    | | - pluginBus cross-events  |   |
|   +-----------------------------------+ +-----------+-----------+ +---------------------------+   |
|                                                     |                                             |
|                                                     v                                             |
|                                         +-----------------------+                                 |
|                                         |   Docker Supervisor   |                                 |
|                                         | docker compose up -d  |                                 |
|                                         | DanyAPI container tail|                                 |
|                                         +-----------+-----------+                                 |
+-----------------------------------------------------|---------------------------------------------+
                                                      |
                                  OpenAI SSE Protocol | http://127.0.0.1:8000/v1
                                  POST /v1/files      | (multipart staging)
                                                      v
+---------------------------------------------------------------------------------------------------+
|                                       CONTAINERIZED ENGINES                                       |
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                       DanyAPI Container (ghcr.io/mindflowgo/danyapi)                      |   |
|   | - Port 8000: OpenAI-compatible API interface                                              |   |
|   | - DeepSeek Web Engine: deepseek-v4-flash, deepseek-v4-pro, flash-thinking                 |   |
|   | - Qwen Multimodal: qwen3.7-plus, qwen3.8-max, vision models                               |   |
|   | - Native Session Store: maps tab_id (session_id) to maintain multi-turn memory            |   |
|   | - File Staging Store: consumes uploaded files for visual & context inference              |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Directory Structure

```
Conclave/
├── assets/                      # Master application icons and brand graphics
│   ├── conclave-app-icon.png  # 1024x1024 master icon
│   └── conclave-app-icon.ico  # Windows multi-resolution icon
│
├── client/
│   ├── web/                     # SvelteKit 5 chat UI harness (Tailwind CSS, runes store)
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── components/  # Sidebar, TabsHeader, PromptInput, ConversationView, NewChatModal
│   │   │   │   ├── stores/      # Reactive harness store (Svelte 5 runes: harness.svelte.ts)
│   │   │   │   ├── services/    # Tauri IPC-driven socket client (orchestratorSocket.svelte.ts)
│   │   │   │   └── utils/       # Window drag utilities for the frameless overlay
│   │   │   └── routes/          # SvelteKit routes: (desktop)/ (main window) & overlay/ (ambient HUD)
│   │   ├── package.json
│   │   └── vite.config.ts       # Vite + SvelteKit plugin config + static adapter
│   │                              # (svelte.config.js was removed in SvelteKit 3)
│   │
│   ├── tauri/                   # Tauri v2 native desktop shell
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml       # Tauri v2 dependencies + tokio-tungstenite + libc
│   │   │   ├── tauri.conf.json  # Dev URL (web:5173), frontendDist (../../web/build)
│   │   │   ├── capabilities/    # Tauri security capabilities (window drag, events, etc.)
│   │   │   ├── icons/           # Generated cross-platform desktop icons
│   │   │   └── src/
│   │   │       ├── main.rs      # Desktop entrypoint & window setup
│   │   │       ├── orchestrator_ws.rs     # Native WebSocket transport, offline queue, auto-reconnect
│   │   │       └── orchestrator_loader.rs # Orchestrator process lifecycle supervisor
│   │   └── package.json
│   │
│   └── data/                    # Client uploads and cache
│
├── api_sandbox/                 # LLM container services and persistent data
│   ├── DanyAPI/                 # Docker Compose project for DanyAPI
│   │   ├── docker-compose.yml   # ghcr.io/mindflowgo/danyapi:latest
│   │   └── .env                 # DeepSeek & Qwen credentials
│   ├── data/                    # Persistent storage for staged files & uploads
│   └── DanyAPI_settings         # Template configuration for DanyAPI container
│
├── sandbox_api                  # Symlink pointing to api_sandbox/ for backward compatibility
│
├── orchestrator/                # Central Bun / TypeScript backend
│   ├── src/
│   │   ├── index.ts             # Bun.serve({ websocket: ... }) server entrypoint with origin security
│   │   ├── bootstrap/           # Environment checks and database setup
│   │   ├── db/
│   │   │   ├── schema.sql       # SQLite schema (projects, tabs, messages, plugins, counters)
│   │   │   ├── helper.ts        # Base58 encoding & compact ID generators
│   │   │   └── index.ts         # bun:sqlite database client & repositories
│   │   ├── mcp/                 # Lightweight Model Context Protocol (MCP) server with path traversal sandbox
│   │   ├── plugins/             # Plugin Manager, McpStdioClient, and plugin event bus
│   │   ├── processes/           # Docker Compose supervisor & live log streamer
│   │   ├── providers/           # Modular API adapters (DanyAPI, DeepSeek, LocalMock)
│   │   └── router/              # LLM provider routing & dispatcher
│   ├── data/
│   │   └── conclave.db        # SQLite database file (WAL mode)
│   └── package.json
│
├── docs/                        # Project documentation & guides
├── UI-PROTOCOL.md               # WebSocket and HTTP interface protocol specification
└── ARCHITECTURE.md              # System specification (this document)
```

---

## 3. Core Component Architecture

### 3.1 `client/web` (SvelteKit 5 Frontend)
- **Role**: High-speed, responsive, frameless chat interface with dual desktop and ambient overlay modes.
- **Tech Stack**: SvelteKit 5 (Runes `$state`, `$derived`, `$effect`), Tailwind CSS, `marked` (GitHub Flavored Markdown), Lucide icons.
- **Key Architectural Patterns**:
  - **Single Store Truth (`harness.svelte.ts`)**: Centralizes tab collections, active tab selection, user settings, streaming states, and model selections using Svelte 5 runes.
  - **Tauri IPC Orchestrator Client (`orchestratorSocket.svelte.ts`)**: The JavaScript client does not maintain a raw browser WebSocket. Instead, it interfaces directly with the native Tauri socket transport:
    - Listens to incoming server frames via `orchestrator-message` Tauri event.
    - Tracks connection lifecycle changes via `orchestrator-status` (`connected`, `connecting`, `disconnected`).
    - Dispatches outbound payloads via `ws_send` Tauri invoke, safely queued natively if offline.
    - Synchronizes environment on initial connection or reconnect via `LOAD_SETTINGS`.
  - **Window Dragging (`drag.ts`)**: Binds primary mouse drag gestures to `window.__TAURI__.window.getCurrentWindow().startDragging()`, guarding interactive controls (`button`, `input`, `textarea`, `[role="tab"]`) to eliminate WebKit drag gesture locking.

### 3.2 `client/tauri` (Tauri v2 Desktop Shell)
- **Role**: Native Windows/Linux frameless application wrapper, multi-window coordinator, and process/transport supervisor.
- **Tech Stack**: Tauri v2, Rust 2021 edition, Tokio async runtime, `tokio-tungstenite`.
- **Subsystems**:
  - **Native WebSocket Transport (`orchestrator_ws.rs`)**:
    - Maintains a single persistent connection to `ws://127.0.0.1:4000/ws` across all app windows (main and overlay).
    - Capped exponential backoff reconnection (`1s` to `15s`), resettable immediately via `ws_reconnect` command.
    - Ring buffer offline queue holding up to 64 outgoing messages, automatically flushed in order upon reconnect.
    - Dispatches parsed messages to all open windows via `orchestrator-message` event broadcast.
  - **Orchestrator Lifecycle Supervisor (`orchestrator_loader.rs`)**:
    - Automatically checks if port 4000 is open; if not, spawns the orchestrator process (`bun src/index.ts` in dev, or bundled sidecar executable in production).
    - Tracks child PID in an `OrchestratorProcess` mutex.
    - Implements graceful shutdown on Unix via `SIGTERM` with a 500ms timeout before falling back to `kill()`, ensuring zero zombie node/bun processes on app exit.
  - **Window Capabilities & Styling**:
    - `titleBarStyle: "Overlay"` with hidden window title for edge-to-edge seamless window frame.
    - Overlay window level set through Tauri's portable `set_always_on_top` (overlay on, main off).

### 3.3 `orchestrator` (Bun / TypeScript Engine)
- **Role**: Central coordinator managing SQLite persistence, LLM stream routing, Docker supervision, MCP tools, and plugins.
- **Tech Stack**: Bun runtime, native `Bun.serve()`, native `bun:sqlite`.
- **Core Subsystems**:
  - **HTTP Server & Origin Security (`index.ts`)**: Origin validation helper (`isAllowedOrigin`) rejecting non-local origins with `403 Forbidden` to prevent browser-based CSRF/RCE. Employs dynamic CORS headers rather than wildcard `*`.
  - **Plugin Subsystem (`plugins/`)**: Comprehensive plugin engine supporting MCP stdio processes, Bun background plugins, and Docker-managed services. Tools are dynamically registered and namespaced.
  - **Service Supervisor (`supervisor.ts`)**: Launches `docker compose up -d` in `api_sandbox/DanyAPI`, monitors health on `http://127.0.0.1:8000/v1/models`, and streams live container logs with `[DanyAPI]` prefix.
  - **Modular API Providers (`providers/`)**:
    - `danyapi.ts` (`DanyApiProvider`): Manages DanyAPI / DeepSeek on port 8000, multi-turn `session_id = tab_id` mapping, multimodal vision promotion, and token usage accounting.
    - `mock.ts` (`LocalMockProvider`): Graceful offline fallback.
  - **LlmRouter (`router/index.ts`)**: Central dispatcher mapping `tabId` to inference streaming. Formats clean error messages and prevents token duplication on upstream failure.
  - **Database Repositories (`db/index.ts`)**: WAL-mode SQLite operations managing projects, tabs, messages, tool steps, settings, uploads, and plugins.
  - **MCP Server (`mcp/index.ts`)**: Sandboxed Model Context Protocol tool execution engine (`run_command`, `read_file`, `write_file`) strictly confined to workspace `rootDir`.

---

## 4. Data Model: Base58 Compact ID System

All entity IDs use **Base58** encoding (alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`) for compact, URL-safe, sortable identifiers. The encoding is implemented in [`helper.ts`](orchestrator/src/db/helper.ts).

### 4.1 Three-Table Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│  PROJECT  (3 b58 chars, sequential)                                │
│  id: "112"  name: "Website"  directory: "C:/Code/project/..."      │
│  skills: ["code-review", ...]  metadata: { instructions: "..." }   │
│                                                                     │
│  ┌───────────────────────────────────┐  ┌─────────────────────────┐ │
│  │  TAB  (4 b58 chars, sequential)  │  │  TAB                    │ │
│  │  id: "1112"  name: "Bug fix"     │  │  id: "1113"             │ │
│  │  session_id for LLM = tab.id     │  │  name: "Code review"   │ │
│  │                                   │  │                         │ │
│  │  ┌───────────────────────────┐   │  │  ┌───────────────────┐  │ │
│  │  │ MSG  (4+8 = 12 chars)    │   │  │  │ MSG               │  │ │
│  │  │ id: "1112" + "aX9kQ2mP"  │   │  │  │ ...               │  │ │
│  │  │ ├── tab prefix extracts  │   │  │  └───────────────────┘  │ │
│  │  │ │   all msgs for tab     │   │  │                         │ │
│  │  │ role: user / assistant   │   │  └─────────────────────────┘ │
│  │  └───────────────────────────┘   │                              │
│  └───────────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 ID Generation Scheme

| Entity | Method | Length | Range | Example |
|---|---|---|---|---|
| **project_id** | Sequential counter, Base58 padded | 3 chars | 58³ = 195,112 | `112` |
| **tab_id** | Sequential counter (global), Base58 padded | 4 chars | 58⁴ = 11,316,496 | `1112` |
| **message_id** | tab_id (4) + timestamp-seconds (6) + random (2) | 12 chars | Sortable by time | `1112aX9kQ2mP` |
| **tool_step_id** | timestamp-seconds (6) + random (2) | 8 chars | Sortable by time | `aX9kQ2mP` |

- **Sequential IDs** (`project_id`, `tab_id`): Stored in a `counters` table, incremented atomically. Base58 encoded with `padStart` to fixed width.
- **Timestamp IDs** (`message_id`, `tool_step_id`): Unix seconds encoded as 6 Base58 chars (valid until year 3200+), plus 2 chars of randomness (58² = 3,364 values/second).
- **Message prefix extraction**: The first 4 chars of any `message_id` are its `tab_id`, enabling `WHERE id LIKE 'XXXX%'` queries or simple `substring(id, 0, 4)` extraction without a join.

### 4.3 `encodeB58(n, length)` — Core Encoder

```typescript
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeB58(n: number, length: number): string {
    let out = '';
    let val = n;
    while (val > 0) {
        out = B58[val % 58] + out;
        val = Math.floor(val / 58);
    }
    return out.padStart(length, '1');  // '1' is Base58 zero
}
```

### 4.4 Session Architecture & Multi-Turn Continuation

The `tab_id` directly serves as the LLM `session_id`, eliminating a separate ID mapping layer:

```
[Client: Create Tab]
         │
         ▼
TAB_CREATE { projectId } ──→ Server assigns sequential tab_id: "1112"
         │
         ▼
[Client: Send Message]
         │
PROMPT_SEND { tabId: "1112", content: "..." }
         │
         ▼
[Orchestrator LlmRouter]
  session_id = tabId = "1112"
  POST /v1/chat/completions { "session_id": "1112", ... }
         │
         ▼
[DanyAPI Container :8000]
  Acquires/reuses session pool for "1112"
         │
         ▼
[DeepSeek / Qwen Upstream]
  Continues existing thread with full context
```

**Lifecycle Rules:**
1. **Tab Creation**: Server-generated sequential Base58 ID. Client receives it via `TAB_CREATED` WebSocket message.
2. **Session Binding**: Tab ID is passed as `session_id` to DanyAPI on every prompt, maintaining multi-turn memory upstream.
3. **Message Ordering**: Messages within a tab are timestamp-sorted, with the tab prefix baked into every message ID for fast extraction.

---

## 5. Multimodal File Staging & Multi-Attachment Pipeline

Conclave supports attaching single or multiple images, text files, and documents directly to chat sessions.

```
[User Selects or Drops File in PromptInput]
                     │
                     ▼
       POST http://127.0.0.1:4000/api/upload
       - FormData: file=@person.jpg
       - session_id: chat-1789081234567
       - model: deepseek-v4-vision / qwen3.7-plus
                     │
                     ├─────────────────────────────────────────────────┐
                     ▼                                                 ▼
1. Save locally to `api_sandbox/data/person.jpg`        2. Forward to DanyAPI:
   Record metadata in SQLite `uploads` table              POST http://127.0.0.1:8000/v1/files
                                                          - file=@person.jpg
                                                          - session_id=chat-1789081234567
                                                                       │
                                                                       ▼
                                                       3. DanyAPI Stages File Record
                                                          Stored in memory mapped to session_id
                                                                       │
                                                                       ▼
[User Submits Message: "Describe this image"]                          │
                     │                                                 │
                     ▼                                                 │
       POST /v1/chat/completions { session_id: "chat-..." }            │
                     │                                                 │
                     ▼                                                 │
   DanyAPI consumes staged file record <───────────────────────────────┘
   Auto-selects vision model & attaches image data
                     │
                     ▼
   Streams multimodal completion back over WebSocket
```

### 5.1 End-to-End Staging Rules
- **Multi-File Concurrency**: Users can attach multiple files simultaneously via `<input type="file" multiple>` or drag-and-drop. Each file displays a live status chip (`uploading`, `ready`, `failed`) with formatted file size and remove button.
- **Disk Persistence**: Files are safely saved to `api_sandbox/data` on the host machine for inspection, debugging, and offline reference.
- **Session Associativity**: Files are bound to the conversation's `chatId` (`session_id`). When the completion request fires with that `session_id`, DanyAPI automatically links all staged files to the inference call.
- **Conversation History Attachment Pills**: When messages are rendered in `ConversationView.svelte`, attached files are displayed as compact metadata pills with dedicated file/image icons and file sizes.

---

## 6. Client UX, Markdown Engine & Code Block Delineation

### 6.1 Clean Stream & Typing Indicator
- **No Synthetic Tool Badges**: Standard chat messages stream directly into the view without displaying internal "Connecting to DeepSeek on localhost:8000" badges.
- **Animated Typing Indicator**: While waiting for the initial token from the engine, an animated 3-dot bouncing bubble (`animate-bounce` with staggered animation delays) indicates that the model is processing.

### 6.2 Viewport Positioning on User Query
- When the user submits a question, `ConversationView.svelte` smooth-scrolls the new user question into view centered (`block: 'center'`).
- The message area has generous bottom padding (`pb-16`), ensuring that the active turn has ample breathing room above the floating prompt dock.

### 6.3 Delineated Code Blocks & Syntax Highlighting (`highlight.js`)
- **Engine**: Powered by `marked` integrated with `highlight.js` and GitHub Dark styling (`github-dark.css`).
- **Clean Delineation**:
  - **Header Bar**: Displays a subtle status dot, the language identifier (e.g., `python`, `typescript`, `rust`, `json`, `bash`), and an interactive copy button.
  - **One-Click Copy with Feedback**: Click delegation decodes and copies code to clipboard, temporarily displaying `"Copied!"` with green feedback for 2 seconds.
  - **Rich Syntax Highlighting**: Keywords, functions, strings, constants, and built-ins are distinctively highlighted with dark theme contrast.
  - **Reasoning Process Blocks**: Native handling of DeepSeek `<think>...</think>` tokens, rendering internal chain-of-thought in a collapsible box with a brain icon (`🧠 Reasoning Process`).
### 6.4 Token Usage Display
- **Detection & Extraction**: In `orchestrator/src/providers/danyapi.ts`, whenever DanyAPI emits SSE usage chunks (`"usage": { "prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ... }`), the orchestrator extracts `totalTokens` and transmits `CHAT_USAGE` / `CHAT_COMPLETE` to the client.
- **Persistence**: Total tokens are stored in the SQLite `messages.usage` column and reconstituted when conversations are fetched.
- **Clean UI Placement**: In `ConversationView.svelte`, right below the assistant message output on the right-hand side, a subtle small grey indicator (`text-[10px] text-zinc-500 font-mono`) displays `Tokens used: <count>`.

### 6.5 Model Selection & Dynamic Dispatch
- **Simplified UI Options**: The model selector dropdown cleanly exposes two primary models:
  - **`Deepseek v4`** (initial default selection)
  - **`Qwen3.7-Plus`**
- **Clean Interface**: Eliminates raw technical terms like "default" and badge pills from the user interface.
- **Orchestrator Protocol Translation**:
  - When **`Deepseek v4`** is selected, the orchestrator does not pass `'Deepseek v4'` to the backend; it sends `model: 'default'` and the session's `session_id`.
  - When **`Qwen3.7-Plus`** is selected, the orchestrator automatically normalizes the model name to lowercase `model: 'qwen3.7-plus'` for completions and file staging endpoints (`POST /v1/files`).

---

## 7. Storage Specification: SQLite (`bun:sqlite`)

The database file resides at `orchestrator/data/conclave.db`.

### 7.1 Schema

```sql
-- Sequence counters for Base58 IDs
CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,          -- 'project' | 'tab'
    value INTEGER NOT NULL DEFAULT 0
);

-- Projects (collective info: path, skills, instructions shared with LLM)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,           -- 3 b58 chars (sequential)
    name TEXT NOT NULL,
    icon TEXT,
    directory_path TEXT,           -- project root filesystem path
    skills TEXT,                   -- JSON array of enabled skills/tools
    metadata TEXT,                 -- JSON: collective info, instructions, scope
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tabs (chat threads within a project, id doubles as LLM session_id)
CREATE TABLE IF NOT EXISTS tabs (
    id TEXT PRIMARY KEY,           -- 4 b58 chars (sequential, global)
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,            -- user-editable tab name
    last_response TEXT,            -- snippet of last LLM response
    last_model TEXT,               -- model used in last exchange
    archived INTEGER NOT NULL DEFAULT 0, -- 1 if archived, 0 if active
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Messages (user/assistant/system within a tab)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,           -- tab_id (4) + timestamp+random (8) = 12 chars
    tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    attachments TEXT,              -- JSON: [{name, filepath, mimeType, size}]
    model TEXT,                    -- model used for this exchange
    usage TEXT,                    -- JSON: {totalTokens, ...}
    created_at INTEGER NOT NULL
);

-- Tool Steps (associated with assistant messages)
CREATE TABLE IF NOT EXISTS tool_steps (
    id TEXT PRIMARY KEY,           -- 8 b58 chars (timestamp+random)
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    badge_count INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('running', 'done', 'error')),
    details TEXT,                  -- JSON payload of steps / diffs
    created_at INTEGER NOT NULL
);

-- User Settings & Parameters
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Client Uploads Metadata
CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL
);

-- Service Health & Supervisor State
CREATE TABLE IF NOT EXISTS service_state (
    name TEXT PRIMARY KEY,
    port INTEGER,
    status TEXT NOT NULL,
    last_ping INTEGER NOT NULL,
    error TEXT
);

-- Plugins (dynamic extensions, MCP servers & process plugins)
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,            -- 'mcp' | 'bun' | 'docker'
    enabled INTEGER NOT NULL DEFAULT 1,
    manifest TEXT NOT NULL,        -- full manifest JSON
    status TEXT NOT NULL DEFAULT 'stopped',
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### 7.2 ID Helper Functions (`orchestrator/src/db/helper.ts`)

```typescript
newProjectId(seq)          // encodeB58(seq, 3) → "112"
newTabId(seq)              // encodeB58(seq, 4) → "1112"
newMessageId(tabId)        // tabId + encodeB58(ts, 6) + encodeB58(rand, 2) → "1112aX9kQ2mP"
newToolStepId()            // encodeB58(ts, 6) + encodeB58(rand, 2) → "aX9kQ2mP"
```

### 7.3 Sequential Counter Management

```typescript
// Atomic increment in counters table
function nextSeq(name: string): number {
    const row = db.query('SELECT value FROM counters WHERE name = ?').get(name);
    const next = row ? row.value + 1 : 1;
    db.prepare('INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)').run(name, next);
    return next;
}
```

---

## 8. Plugin Subsystem Architecture (`orchestrator/src/plugins/`)

The plugin subsystem provides an extensible architecture for adding MCP tooling, local service processes, and external engine connectors without modifying core orchestrator code.

```
┌────────────────────────────────────────────────────────────────────────┐
│ PLUGIN MANAGER (`PluginManager`)                                       │
│                                                                        │
│   ┌───────────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│   │ Stdio MCP Subprocess  │  │   Bun Process    │  │ Docker Compose │  │
│   │ type: 'mcp'           │  │   type: 'bun'    │  │ type: 'docker' │  │
│   │ (McpStdioClient)      │  │ (child_process)  │  │  (supervisor)  │  │
│   └───────────┬───────────┘  └────────┬─────────┘  └────────┬───────┘  │
│               │                       │                     │          │
│               ▼                       ▼                     ▼          │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Tool Registry & Namespacing: `plugin_<id>_<toolName>`          │   │
│   │ Aggregated into orchestrator's central MCP interface           │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
│                                    ▼                                   │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Cross-Process Plugin Event Bus (`pluginBus`)                   │   │
│   │ Emits `tab-updated` to notify open windows of MCP-driven chats │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Manifest Structure (`PluginManifest`)
Each plugin defines a `plugin.json` manifest:
```typescript
export interface PluginManifest {
    id: string;               // Unique plugin identifier
    name: string;             // Human-readable display label
    version?: string;         // Semantic version string
    type: 'mcp' | 'bun' | 'docker';
    command?: string;         // Subprocess command for 'mcp' (stdio JSON-RPC)
    args?: string[];          // Arguments passed to subprocess
    env?: Record<string, string>;
    entrypoint?: string;      // Entrypoint script for 'bun' plugins
    port?: number;            // Healthcheck port for background services
    serviceName?: string;     // Service identifier for 'docker' plugins
    mcp?: {
        tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>;
        scaffold?: string;    // Custom JS file exporting tool call handlers
    };
    models?: Array<{ id: string; name?: string }>;
}
```

### 8.2 Subsystem Components
1. **`McpStdioClient`**: Manages stdio newline-delimited JSON-RPC communication with subprocess MCP servers. Automatically initiates protocol handshakes, enumerates available tools via `tools/list`, and routes invocations through `tools/call`. Handles subprocess exits and cancellations safely by clearing timers and rejecting pending requests.
2. **`PluginManager`**:
   - Manages plugin lifecycle (`restore`, `register`, `toggle`, `remove`, `installFromGit`).
   - Dynamically exposes enabled plugin tools into the orchestrator MCP tool registry with prefix `plugin_<id>_<toolName>`.
   - Persists manifest states and enabled toggles to SQLite `plugins` table.
3. **`pluginBus` Event Bus**: An in-process event hub enabling decoupled plugins to trigger orchestrator broadcasts (e.g. `pluginBus.emit('tab-updated', { tabId })` when external MCP threads create or mutate conversations).

---

## 9. WebSocket & HTTP Protocol Specification

### 9.1 WebSocket: `ws://127.0.0.1:4000/ws`

The native transport is managed in Rust (`client/tauri/src-tauri/src/orchestrator_ws.rs`). Web clients dispatch and listen through Tauri IPC.

#### Client -> Orchestrator Messages

| Type | Payload | Description |
|---|---|---|
| `LOAD_SETTINGS` | `{ clientVersion?: string }` | Handshake acknowledgment; requests current settings, projects, tabs, models, and plugins |
| `TAB_CREATE` | `{ projectId?: string, name?: string }` | Create a new tab (chat thread) with sequential Base58 ID |
| `TAB_FETCH` | `{ tabId: string, days?: number }` | Retrieve message history and tool execution steps for a tab |
| `TAB_RENAME` | `{ tabId: string, name: string }` | Rename a tab (updates title in SQLite and broadcasts to all clients) |
| `TAB_DELETE` | `{ tabId: string }` | Delete tab, cascade remove messages, and best-effort cleanup upstream provider session |
| `TAB_ARCHIVE` | `{ tabId: string, archived?: boolean }` | Toggle archive state of a tab |
| `PROMPT_SEND` | `{ tabId: string, content: string, attachments?: [], provider?: string, model?: string }` | Send user message; `tabId` serves as upstream `session_id` |
| `SETTINGS_SET` | `{ key: string, value: any }` | Update configuration parameter in SQLite `settings` table |
| `PLUGIN_LIST` | `{}` | Query currently installed plugins and status |
| `PLUGIN_INSTALL`| `{ url?: string, manifest?: object }` | Install plugin from Git repository or raw manifest |
| `PLUGIN_REMOVE` | `{ id: string }` | Uninstall plugin and remove from filesystem and registry |
| `PLUGIN_TOGGLE` | `{ id: string, enabled: boolean }` | Enable or disable a plugin at runtime |
| `MCP_REQUEST` | `{ rpc: { jsonrpc: '2.0', id, method, params } }` | Execute Model Context Protocol tool |

#### Orchestrator -> Client Messages

| Type | Payload | Description |
|---|---|---|
| `SERVER_READY` | `{ serverVersion: string, status: 'ready' }` | Initial socket connection acknowledgement |
| `SETTINGS_LOADED` | `{ projects, tabs, settings, services, models, plugins }` | Complete environment state payload in response to `LOAD_SETTINGS` |
| `TAB_CREATED` | `{ tab: Tab }` | Confirms tab creation with server-assigned Base58 ID |
| `TAB_DETAIL` | `{ tabId: string, messages: Message[] }` | Full message history and tool steps for requested tab |
| `TAB_RENAMED` | `{ tabId: string, name: string }` | Broadcast notification when a tab is renamed |
| `TAB_DELETED` | `{ tabId: string }` | Broadcast notification when a tab is deleted |
| `TAB_ARCHIVED` | `{ tabId: string, archived: boolean }` | Broadcast notification when tab archive status changes |
| `TAB_UPDATED` | `{ tabId: string, lastMessageId?: string }` | Broadcast notification when messages in a tab have updated |
| `CHAT_TOKEN` | `{ tabId: string, token: string }` | Incremental streamed LLM response token |
| `CHAT_USAGE` | `{ tabId: string, totalTokens: number, model?: string }` | Token usage from upstream provider |
| `TOOL_STEP_UPDATE`| `{ tabId: string, step: ToolStep }` | Real-time tool execution status, badge count, and details |
| `CHAT_ERROR` | `{ tabId: string, error: string }` | Formatted LLM provider error message |
| `CHAT_COMPLETE` | `{ tabId: string, messageId: string, totalTokens?: number, model?: string }` | Stream completion signal |
| `PLUGINS_UPDATED` | `{ plugins: PluginInfo[] }` | Broadcast of updated plugin list and states |
| `PLUGIN_ERROR` | `{ error: string, source: string }` | Plugin operation failure alert |
| `SETTINGS_UPDATED`| `{ settings: Record<string, string> }` | Broadcast of updated key-value settings |
| `MCP_RESPONSE` | `{ rpc: { jsonrpc: '2.0', id, result, error } }` | MCP JSON-RPC execution result |
| `ERROR` | `{ message: string }` | Unhandled error response |

### 9.2 HTTP REST Endpoints

All endpoints validate the `Origin` header against local authorized origins (`tauri://localhost`, `127.0.0.1`, `localhost`), rejecting untrusted origins with `403 Forbidden`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | JSON-RPC 2.0 Model Context Protocol endpoint (confined to workspace root; notifications return `204 No Content`). |
| `POST` | `/api/upload` | Multipart file upload (`file`, `session_id`, `model`). Saves to disk and forwards to DanyAPI `/v1/files`. |
| `GET` | `/api/tabs` | Retrieves array of all active and archived tabs. |
| `GET` | `/api/tabs/:id/messages?days=7` | Direct query of tab message history and nested tool steps. |
| `DELETE` | `/api/tabs/:id` | Deletes tab and triggers best-effort upstream session teardown. |
| `GET` | `/api/projects` | Retrieves array of all registered projects. |
| `GET` | `/api/settings` | Retrieves key-value map of all saved settings. |
| `GET` | `/api/settings/load` | Returns complete initial bootstrap payload (projects, tabs, settings, services, models). |
| `GET` | `/health` | Returns supervisor telemetry, active Docker container status, and database metrics. |
| `GET` | `/api/log?err=...&msg=...` | Client diagnostics logging endpoint. |

---

## 10. Security Architecture & Sandboxing

Conclave enforces defense-in-depth isolation across browser vectors, process execution, and the filesystem:

### 10.1 Origin Validation & Dynamic CORS
- **Threat Vector**: Malicious web pages visited in regular browsers could perform CSRF or DNS rebinding against `http://127.0.0.1:4000/mcp` to execute arbitrary commands.
- **Protection**:
  - `isAllowedOrigin(origin)` validates every incoming HTTP request and WebSocket upgrade.
  - Allowed origins: `tauri://localhost`, `app://localhost`, `tauri.localhost`, `localhost`, `127.0.0.1`, and direct non-browser tools (no `Origin` header).
  - Any request with a foreign browser origin is immediately rejected with `403 Forbidden: Untrusted Origin`.
  - Replaced wildcard `Access-Control-Allow-Origin: *` with dynamic origin reflection restricted to validated origins.

### 10.2 MCP Tool Filesystem Containment
- **Threat Vector**: Relative path parameters (`../../etc/passwd`) escaping into host filesystem.
- **Protection**:
  - Workspace root is anchored to `process.env.CONCLAVE_PROJECT_ROOT || process.cwd()`.
  - In `read_file` and `write_file`, all paths are normalized via `resolve(this.rootDir, path)` and checked with `.startsWith(this.rootDir)`. Unsafe paths return permission errors.
  - In `run_command`, execution directory `cwd` is validated to ensure it cannot escape outside `this.rootDir`.
  - Process stdout and stderr are captured with a 10MB `maxBuffer` to prevent truncated diagnostics.

### 10.3 Safe Process Teardown
- Orchestrator child processes and MCP stdio clients are terminated using standard Unix `SIGTERM` with timeout before escalating to `SIGKILL`, allowing WAL checkpoints, socket cleanups, and file flush operations to complete cleanly.
- `McpStdioClient` clears pending timers and rejects outstanding promises upon shutdown, preventing promise leaks.

---

## 11. Process Supervision & Container Ports

| Service | Mode | Port | Config / Directory | Description |
|---|---|---|---|---|
| **Orchestrator** | Bun Native | `4000` | `orchestrator/src/index.ts` | Central WebSocket server, SQLite persistence, router |
| **DanyAPI** | Docker Container | `8000` | `api_sandbox/DanyAPI/docker-compose.yml` | OpenAI-compatible DeepSeek/Qwen container (`ghcr.io/mindflowgo/danyapi:latest`) |
| **Web Dev Client** | Vite / SvelteKit | `5173` | `client/web` | Development web server with HMR |
| **Tauri Desktop** | Native Release | - | `client/tauri/src-tauri` | Desktop binary embedding `client/web/build` |

---

## 12. Verification & Quality Assurance

1. **Frontend Production Build**: `bun run build` / `vite build` in `client/web` outputs static assets to `client/web/build` with 0 errors.
2. **Desktop Binary Compilation**: `cargo check` / `cargo build` in `client/tauri/src-tauri` compiles cleanly with 0 errors.
3. **TypeScript Build Check**: `bun build --target=bun src/index.ts --no-bundle` in `orchestrator` compiles cleanly with 0 errors.
4. **End-to-End WebSocket Stream**: Verified prompts stream tokens from Docker port 8000 through native Tauri socket transport to the Svelte UI in real time.
5. **Session Continuity**: Multi-turn prompts reuse `session_id = tab_id` to maintain context without data loss.
6. **File Staging**: Verified file uploads via `POST /api/upload` persist to `api_sandbox/data` and stage in DanyAPI for multimodal question-answering.

---

## 13. Window Management, Multi-Monitor Safety & Overlay Architecture

Conclave utilizes a dual-window model in Tauri v2 for robust floating HUD operation:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TAURI DESKTOP APPLICATION SHELL                                        │
│                                                                        │
│   ┌───────────────────────────┐      ┌───────────────────────────┐     │
│   │ "main" WebviewWindow      │      │ "overlay" WebviewWindow   │     │
│   │ Full desktop chat UI      │      │ Transparent HUD & Prompt  │     │
│   │ Normal window level       │      │ Always-on-top level       │     │
│   │ TitleBarStyle: Overlay    │      │ Frameless, Transparent   │     │
│   └─────────────┬─────────────┘      └─────────────┬─────────────┘     │
│                 │                                  │                   │
│                 ▼                                  ▼                   │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │ NATIVE WINDOW INTEGRATIONS (Tauri v2)                        │     │
│   │                                                              │     │
│   │ 1. Always-On-Top Window Levels:                              │     │
│   │    • Overlay window: set_always_on_top(true)                 │     │
│   │    • Main window:    set_always_on_top(false)                │     │
│   │                                                              │     │
│   │ 2. Multi-Monitor Coordinate Clamping:                        │     │
│   │    • available_monitors() bounds validation                  │     │
│   │    • Off-screen recovery (unplugged monitors fallback)       │     │
│   │                                                              │     │
│   │ 3. Native Move Persistence:                                  │     │
│   │    • WindowEvent::Moved auto-persists to ~/.conclave.json    │     │
│   │                                                              │     │
│   │ 4. Application Lifecycle:                                    │     │
│   │    • exit_app terminates all processes cleanly (no zombies)  │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

### 13.1 Multi-Monitor Clamping & Off-Screen Protection
* When switching modes (`enter_overlay_mode`, `exit_overlay_mode`) or on app launch, target coordinates `(x, y)` from `~/.conclave.json` are validated against `app.available_monitors()`.
* If a target position lands outside all active display viewports (e.g. secondary monitor was unplugged or arrangement changed), the window is clamped safely to the primary monitor (`x: mon_x + 24.0, y: mon_y + 100.0` for overlay).

### 13.2 Platform Scope: Windows & Linux Only
* Conclave targets Windows and Linux only, and is never built or shipped for any other platform.
* Earlier revisions configured the overlay through the native window layer (an `objc2` dependency plus the Tauri native-private-API feature) so the HUD floated above fullscreen apps on every virtual Space.
* That configuration, its dependency, and its setup hook have all been removed, because the product does not target that platform; the floating HUD relies on portable always-on-top behaviour instead.

### 13.3 Window Move Tracking & Persistence
* Native `WindowEvent::Moved` events captured in Tauri's event loop automatically update `state.minimalist.x/y` or `state.normal.x/y` and persist them to `~/.conclave.json`.
* Both frontend layouts (`(desktop)/+layout.svelte` and `overlay/+page.svelte`) call `initWindowListeners()` to register window resize and move synchronization.

### 13.4 Application Lifecycle
* **Clean Termination**: The overlay's Quit command invokes native `exit_app` (`app.exit(0)`), ensuring the main window, overlay, and background supervisor processes terminate simultaneously with zero orphan/zombie processes.
* **Reopen Handling**: The prior handler for a platform dock-reopen event (unhiding and focusing the main window) was removed with the platform-specific setup. Neither supported platform exposes an equivalent event, so window restoration is driven from the frontend instead.

### 13.5 Cross-Window Event Bridge & Multi-Layer Thread Synchronization
* **Cross-Window Handover**: When transitioning from the ambient overlay to the full desktop chat ("Open Chat" or "Restore Full Window"):
  * `exit_overlay_mode(tab_id)` passes `tabId` directly into Rust.
  * Rust native code shows and focuses the main window, then emits `main_win.emit("refresh-active-thread", { tabId })` directly from native code (bypassing webview permissions).
  * The overlay emits Tauri cross-window events (`switch-tab`, `refresh-active-thread`) enabled by explicit `core:event:default`, `core:event:allow-emit`, `core:event:allow-listen` permissions in `capabilities/default.json`.
  * The overlay updates `conclave_active_tab` and timestamp `conclave_refresh_ts` in shared `localStorage`.
* **Multi-Event Desktop Triggers**: The main window (`(desktop)/+layout.svelte`) triggers `refreshActiveThread(tabId)` upon:
  1. Native Rust `refresh-active-thread` event
  2. Frontend Tauri `switch-tab` event
  3. Browser `window.onstorage` event (cross-webview event on the shared origin)
  4. Webview `window.onfocus` and `document.visibilitychange`
* **Direct Dual-Fetch (HTTP + WebSocket)**:
  * `harness.fetchTabMessages(tabId)` executes an immediate direct HTTP `fetch` to `http://127.0.0.1:4000/api/tabs/:id/messages` (direct Bun SQLite query, $\sim 2\text{ms}$ latency) followed by WebSocket state alignment.
  * Ensures that messages generated in overlay mode are immediately retrieved into memory even before WebSocket handshake reconnects.
* **Orchestrator Multi-Client Broadcasting**:
  * The Bun orchestrator tracks all connected WebSocket clients (`connectedClients = new Set()`).
  * Changes to tabs (`TAB_CREATED`, `TAB_RENAMED`, `TAB_DELETED`) and prompt completions (`TAB_UPDATED`) are broadcast to all connected webviews simultaneously.
* **Svelte 5 Reactivity & Auto-Scroll**:
  * `handleTabDetail` dynamically adds missing tabs, updates message arrays, and forces re-evaluation of Svelte 5 `$derived` state via `this.conversations = [...this.conversations]`.
  * `ConversationView` monitors both active conversation ID and message counts, automatically scrolling the conversation container to the bottom so that newly generated overlay messages are immediately in view.

### 13.6 Single-IPC Sizing, Rigid Idle Geometry & Ambient Ergonomics
* **Locked Idle Bounds**: The idle minimalist HUD dimensions are rigidly invariant at `200×56` px across Rust and TypeScript. Expanding states (`prompt` at `560×170`, `response` at `560×320`, `error`) never overwrite or drift the idle HUD geometry in `~/.conclave.json`.
* **Widened Prompt Box & Enhanced Legibility**: The prompt input and response cards are widened by 100px (to 560px), with font size elevated to `13.5px` (`text-[13.5px]`), providing comfortable multi-line typing and code reading in floating ambient mode.
* **Distraction-Free UI**: The LLM model button/badge is excluded from overlay mode to keep the ambient pill focused strictly on the prompt and response stream.
* **Deduplicated IPC**: Sizing operations route exclusively through the native `set_overlay_size` command, eliminating duplicate `win.setSize()` IPC roundtrips.
* **RAF Throttling**: Grip resizing on the prompt box is throttled with `requestAnimationFrame`, preventing IPC flooding during pointer drag interactions.


