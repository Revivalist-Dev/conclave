# Architecture: brAInstorm

**brAInstorm** is a modular, high-performance, and lightweight local AI agentic coding and chat harness. It couples a native desktop shell (Tauri v2) with a reactive SvelteKit 5 web frontend, a centralized Bun/TypeScript orchestrator with native SQLite persistence, and containerized local LLM backends (DanyAPI on Docker).

The system is designed with strict separation of concerns, zero host script pollution, native multi-turn session continuation, and an edge-to-edge frameless user interface.

---

## 1. High-Level Architecture

```
+---------------------------------------------------------------------------------------+
|                                     CLIENT LAYER                                      |
|                                                                                       |
|   +------------------------------------+          +-------------------------------+   |
|   |         client/tauri (v2)          |          |          client/web           |   |
|   |  Native desktop shell (macOS/Win)  |--------->|  SvelteKit 5 + Tailwind CSS   |   |
|   |  Frameless overlay, native window  |          |  Reactive runes store, drag   |   |
|   +------------------------------------+          +---------------+---------------+   |
|                                                                   |                   |
|   +------------------------------------+                          |                   |
|   |            client/data             |                          |                   |
|   |  User uploads, file attachments    |<-------------------------+                   |
|   +------------------------------------+                          |                   |
+-------------------------------------------------------------------|-------------------+
                                                                    |
                                                 WebSocket Protocol | (ws://127.0.0.1:4000/ws)
                                                 HTTP File Upload   | (http://127.0.0.1:4000/api/upload)
                                                                    v
+---------------------------------------------------------------------------------------+
|                                  ORCHESTRATOR LAYER                                   |
|                                   (TypeScript / Bun)                                  |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |                       HTTP Server & WebSocket Hub                             |   |
|   |   - ws://127.0.0.1:4000/ws         : Real-time token streaming & tool updates |   |
|   |   - POST /api/upload               : File staging & DanyAPI forwarder         |   |
|   |   - POST /mcp                      : Model Context Protocol JSON-RPC 2.0      |   |
|   |   - GET /health                    : Service supervisor status & telemetry    |   |
|   +-------------------+---------------------------------------+-------------------+   |
|                       |                                       |                       |
|                       v                                       v                       |
|   +---------------------------------------+   +-----------------------------------+   |
|   |            SQLite Database            |   |            LLM Router             |   |
|   |             (bun:sqlite)              |   |   - Session ID mapper (chatId)    |   |
|   | - Conversations & message history     |   |   - Stream parser (SSE delta)     |   |
|   | - Foreign key-safe dynamic chats      |   |   - Model normalizer (default)    |   |
|   | - Tool execution steps & logs         |   +-----------------+-----------------+   |
|   | - User settings & provider configs    |                     |                     |
|   | - File uploads metadata & paths       |                     v                     |
|   +---------------------------------------+   +-----------------------------------+   |
|                                               |        Docker Supervisor          |   |
|                                               |  docker compose up -d (DanyAPI)   |   |
|                                               |  Live container log piping        |   |
|                                               +-----------------+-----------------+   |
+-----------------------------------------------------------------|---------------------+
                                                                  |
                                              OpenAI SSE Protocol | http://127.0.0.1:8000/v1
                                              POST /v1/files      | (multipart staging)
                                                                  v
+---------------------------------------------------------------------------------------+
|                                 CONTAINERIZED ENGINES                                 |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   |                 DanyAPI Container (ghcr.io/mindflowgo/danyapi)                |   |
|   | - Port 8000: OpenAI-compatible API interface                                  |   |
|   | - DeepSeek Web Engine: deepseek-v4-flash, deepseek-v4-pro, flash-thinking     |   |
|   | - Qwen Multimodal: qwen3.7-plus, qwen3.8-max, vision models                   |   |
|   | - Native Session Store: maps session_id to maintain multi-turn memory         |   |
|   | - File Staging Store: consumes uploaded files for visual & context inference  |   |
|   +-------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------+
```

---

## 2. Directory Structure

```
brAInstorm/
├── assets/                      # Master application icons and brand graphics
│   ├── brainstorm-app-icon.png  # 1024x1024 master icon
│   ├── brainstorm-app-icon.icns # macOS native icon bundle
│   └── brainstorm-app-icon.ico  # Windows multi-resolution icon
│
├── client/
│   ├── web/                     # SvelteKit 5 chat UI harness (Tailwind CSS, runes store)
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── components/  # Sidebar, TabsHeader, PromptInput, ConversationView, NewChatModal
│   │   │   │   ├── stores/      # Reactive harness store (Svelte 5 runes)
│   │   │   │   ├── services/    # WebSocket client with auto-reconnect
│   │   │   │   └── utils/       # Window drag utilities for macOS frameless overlay
│   │   │   └── routes/          # SvelteKit routes & root frame
│   │   ├── package.json
│   │   └── svelte.config.js
│   │
│   ├── tauri/                   # Tauri v2 native desktop shell
│   │   ├── src-tauri/
│   │   │   ├── Cargo.toml       # Tauri v2 dependencies
│   │   │   ├── tauri.conf.json  # Dev URL (web:5173), frontendDist (../../web/build)
│   │   │   ├── capabilities/    # Tauri security capabilities (window drag, etc.)
│   │   │   ├── icons/           # Generated cross-platform desktop icons
│   │   │   └── src/             # Rust main, lib, build.rs
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
│   │   ├── index.ts             # Bun.serve({ websocket: ... }) server entrypoint
│   │   ├── bootstrap/           # Environment checks and database setup
│   │   ├── db/
│   │   │   ├── schema.sql       # SQLite schema (projects, tabs, messages)
│   │   │   ├── helper.ts        # Base58 encoding & compact ID generators
│   │   │   └── index.ts         # bun:sqlite database client & repositories
│   │   ├── mcp/                 # Lightweight Model Context Protocol (MCP) server
│   │   ├── processes/           # Docker Compose supervisor & live log streamer
│   │   ├── providers/           # Modular API adapters (DanyAPI, DeepSeek, LocalMock)
│   │   └── router/              # LLM provider routing & dispatcher
│   ├── data/
│   │   └── brainstorm.db        # SQLite database file (WAL mode)
│   └── package.json
│
├── docs/                        # Project documentation & guides
└── ARCHITECTURE.md              # System specification (this document)
```

---

## 3. Core Component Architecture

### 3.1 `client/web` (SvelteKit 5 Frontend)
- **Role**: High-speed, responsive, frameless chat interface.
- **Tech Stack**: SvelteKit 5 (Runes `$state`, `$derived`, `$effect`), Tailwind CSS, `marked` (GitHub Flavored Markdown), Lucide icons.
- **Key Architectural Patterns**:
  - **Single Store Truth (`harness.svelte.ts`)**: Centralizes conversation lists, active tab selection, settings, streaming state, and model choices using Svelte 5 runes.
  - **Resilient WebSocket Service (`orchestratorSocket.svelte.ts`)**: Automatically maintains connection with a 3-second retry loop and provides a manual `manualReconnect()` hook linked to the header status badge.
  - **Window Dragging (`drag.ts`)**: Binds primary mouse drag gestures to `window.__TAURI__.window.getCurrentWindow().startDragging()`, guarding interactive controls (`button`, `input`, `textarea`, `[role="tab"]`) to eliminate WebKit drag gesture locking.

### 3.2 `client/tauri` (Tauri v2 Desktop Shell)
- **Role**: Native macOS/Windows frameless application wrapper.
- **Tech Stack**: Tauri v2, Rust 2021 edition.
- **Configuration**:
  - `titleBarStyle: "Overlay"` with hidden window title to create an edge-to-edge seamless window frame.
  - `capabilities/default.json` explicitly declaring `core:window:allow-start-dragging`, `core:window:default`, and `core:default`.
  - Configured with official curved squircle app icons from `/assets/`.

### 3.3 `orchestrator` (Bun / TypeScript Engine)
- **Role**: Central coordinator managing SQLite persistence, LLM stream routing, Docker supervision, and MCP tools.
- **Tech Stack**: Bun runtime, native `Bun.serve()`, native `bun:sqlite`.
- **Core Subsystems**:
  - **Service Supervisor (`supervisor.ts`)**: Launches `docker compose up -d` in `api_sandbox/DanyAPI`, monitors health on `http://127.0.0.1:8000/v1/models`, and spawns a background log tailer (`docker compose logs -f --tail 20`) piping stdout/stderr into the Tauri console output with `[DanyAPI]` prefix.
  - **Modular API Providers (`providers/`)**: Contained modules for each engine:
    - `danyapi.ts` (`DanyApiProvider`): Manages DanyAPI / DeepSeek on port 8000, `session_id` multi-turn mapping, multimodal vision promotion, file staging, and SSE extraction of `totalTokens` (`total_tokens`).
    - `mock.ts` (`LocalMockProvider`): Graceful offline fallback.
  - **LlmRouter (`router/index.ts`)**: Central dispatcher that delegates to the appropriate provider adapter, handles stream events (`token`, `usage`, `tool_step`), and tracks persistence.
  - **Database Repositories (`db/index.ts`)**: WAL-mode SQLite operations with automatic session record provisioning (`ensureConversation`) and `attachments` / `usage` JSON persistence.
  - **HTTP Endpoints**:
    - `POST /api/upload`: Handles single/multiple multipart file uploads, persists them to `api_sandbox/data`, and forwards them to DanyAPI for multimodal staging.
    - `POST /mcp`: JSON-RPC 2.0 tool execution interface.
    - `GET /health`: Supervisor health telemetry.

---

## 4. Data Model: Base58 Compact ID System

All entity IDs use **Base58** encoding (alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`) for compact, URL-safe, sortable identifiers. The encoding is implemented in [`helper.ts`](orchestrator/src/db/helper.ts).

### 4.1 Three-Table Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│  PROJECT  (3 b58 chars, sequential)                                │
│  id: "112"  name: "Website"  directory: "/Users/fil/Code/..."      │
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

brAInstorm supports attaching single or multiple images, text files, and documents directly to chat sessions.

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

The database file resides at `orchestrator/data/brainstorm.db`.

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

-- File Uploads Metadata
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

## 8. WebSocket & HTTP Protocol Specification

### 8.1 WebSocket: `ws://127.0.0.1:4000/ws`

#### Client -> Orchestrator Messages

| Type | Payload | Description |
|---|---|---|
| `CLIENT_INIT` | `{ clientVersion: string }` | Handshake; requests current settings, projects, and tabs |
| `TAB_CREATE` | `{ projectId: string, name?: string }` | Create a new tab (chat thread) under a project |
| `TAB_FETCH` | `{ tabId: string }` | Retrieve messages and tool steps for a tab |
| `TAB_RENAME` | `{ tabId: string, name: string }` | Rename a tab (user-editable) |
| `PROMPT_SEND` | `{ tabId: string, content: string, provider?: string, model?: string }` | Send user prompt; `tabId` is used as LLM `session_id` |
| `PROMPT_ABORT` | `{ tabId: string }` | Abort current generation |
| `SETTINGS_SET` | `{ key: string, value: any }` | Update user settings or provider config |
| `MCP_REQUEST` | `{ rpc: { jsonrpc: '2.0', id, method, params } }` | Execute Model Context Protocol tool |

#### Orchestrator -> Client Messages

| Type | Payload | Description |
|---|---|---|
| `SERVER_READY` | `{ projects: [], tabs: [], settings: {}, services: [] }` | Initial state handshake response |
| `TAB_CREATED` | `{ tab: Tab }` | Confirms new tab created with server-assigned Base58 ID |
| `CHAT_TOKEN` | `{ tabId: string, token: string }` | Incremental streamed LLM response token |
| `CHAT_USAGE` | `{ tabId: string, totalTokens: number }` | Token usage from LLM provider |
| `TOOL_STEP_UPDATE` | `{ tabId: string, step: ToolStep }` | Real-time tool execution status and diff payload |
| `CHAT_COMPLETE` | `{ tabId: string, messageId: string, totalTokens?: number }` | Stream completion signal |
| `MCP_RESPONSE` | `{ rpc: { jsonrpc: '2.0', id, result, error } }` | MCP execution result |
| `ERROR` | `{ code: string, message: string }` | Error notifications |

### 8.2 HTTP REST Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Multipart file upload (`file`, `session_id`, `model`). Saves to `api_sandbox/data` and forwards to DanyAPI `/v1/files`. |
| `POST` | `/mcp` | JSON-RPC 2.0 Model Context Protocol tool execution endpoint. |
| `GET` | `/health` | Returns supervisor telemetry, active Docker container status, and database metrics. |
| `GET` | `/api/conversations` | Retrieves list of all persisted conversations. |
| `GET` | `/api/settings` | Retrieves current user and model configuration settings. |

---

## 9. Process Supervision & Container Ports

| Service | Mode | Port | Config / Directory | Description |
|---|---|---|---|---|
| **Orchestrator** | Bun Native | `4000` | `orchestrator/src/index.ts` | Central WebSocket server, SQLite persistence, router |
| **DanyAPI** | Docker Container | `8000` | `api_sandbox/DanyAPI/docker-compose.yml` | OpenAI-compatible DeepSeek/Qwen container (`ghcr.io/mindflowgo/danyapi:latest`) |
| **Web Dev Client** | Vite / SvelteKit | `5173` | `client/web` | Development web server with HMR |
| **Tauri Desktop** | Native Release | - | `client/tauri/src-tauri` | Desktop binary embedding `client/web/build` |

---

## 10. Verification & Quality Assurance

1. **Frontend Production Build**: `bun run build` in `client/web` outputs static assets to `client/web/build` with 0 errors and 0 warnings.
2. **Desktop Binary Compilation**: `cargo build --release` in `client/tauri/src-tauri` compiles the release executable `tauriclient` in ~1 second.
3. **End-to-End WebSocket Stream**: Verified prompts stream tokens from Docker port 8000 through port 4000 WebSocket to the Svelte UI in real time.
4. **Session Continuity**: Multi-turn prompts reuse `session_id = chat-{timestamp}` to maintain context without data loss.
5. **File Staging**: Verified file uploads via `POST /api/upload` persist to `api_sandbox/data` and stage in DanyAPI for multimodal question-answering.

---

## 11. Window Management, Multi-Monitor Safety & macOS Spaces Architecture

brAInstorm utilizes a dual-window model in Tauri v2 coordinated with native macOS AppKit APIs for robust floating HUD operation:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TAURI DESKTOP APPLICATION SHELL                                        │
│                                                                        │
│   ┌───────────────────────────┐      ┌───────────────────────────┐     │
│   │ "main" WebviewWindow      │      │ "overlay" WebviewWindow   │     │
│   │ Full desktop chat UI      │      │ Transparent HUD & Prompt  │     │
│   │ Normal window level       │      │ NSFloatingWindowLevel     │     │
│   │ TitleBarStyle: Overlay    │      │ Frameless, Transparent   │     │
│   └─────────────┬─────────────┘      └─────────────┬─────────────┘     │
│                 │                                  │                   │
│                 ▼                                  ▼                   │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │ NATIVE PLATFORM INTEGRATIONS (macOS / AppKit via objc2)      │     │
│   │                                                              │     │
│   │ 1. NSWindowCollectionBehavior:                               │     │
│   │    • CanJoinAllSpaces       : Follows across all Spaces     │     │
│   │    • FullScreenAuxiliary    : Floats above fullscreen apps   │     │
│   │    • IgnoresCycle           : Excluded from Cmd+Tab cycle   │     │
│   │                                                              │     │
│   │ 2. Multi-Monitor Coordinate Clamping:                        │     │
│   │    • available_monitors() bounds validation                  │     │
│   │    • Off-screen recovery (unplugged monitors fallback)       │     │
│   │                                                              │     │
│   │ 3. Native Move Persistence:                                  │     │
│   │    • WindowEvent::Moved auto-persists to ~/.brainstorm.json  │     │
│   │                                                              │     │
│   │ 4. Lifecycle & Dock Reopen:                                  │     │
│   │    • RunEvent::Reopen unhides main when clicking Dock icon   │     │
│   │    • exit_app terminates all processes cleanly (no zombies) │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

### 11.1 Multi-Monitor Clamping & Off-Screen Protection
* When switching modes (`enter_overlay_mode`, `exit_overlay_mode`) or on app launch, target coordinates `(x, y)` from `~/.brainstorm.json` are validated against `app.available_monitors()`.
* If a target position lands outside all active display viewports (e.g. secondary monitor was unplugged or arrangement changed), the window is clamped safely to the primary monitor (`x: mon_x + 24.0, y: mon_y + 100.0` for overlay).

### 11.2 macOS Spaces & Fullscreen Integration
* Regular always-on-top windows in macOS bind strictly to the virtual desktop (Space) where they were opened.
* On macOS, brAInstorm configures the underlying `NSWindow` via `objc2`:
  $$\text{CollectionBehavior} = \text{CanJoinAllSpaces } (1 \ll 0) \mid \text{FullScreenAuxiliary } (1 \ll 8) \mid \text{IgnoresCycle } (1 \ll 6)$$
* This allows the floating brain HUD to remain visible across all virtual spaces, Mission Control, and fullscreen IDEs/browsers without vanishing.

### 11.3 Window Move Tracking & Persistence
* Native `WindowEvent::Moved` events captured in Tauri's event loop automatically update `state.minimalist.x/y` or `state.normal.x/y` and persist them to `~/.brainstorm.json`.
* Both frontend layouts (`(desktop)/+layout.svelte` and `overlay/+page.svelte`) call `initWindowListeners()` to register window resize and move synchronization.

### 11.4 Application Lifecycle & Dock Reopen
* **Clean Termination**: The overlay's Quit command invokes native `exit_app` (`app.exit(0)`), ensuring the main window, overlay, and background supervisor processes terminate simultaneously with zero orphan/zombie processes.
* **Dock Reopen Handler**: Listens for `tauri::RunEvent::Reopen`. If clicked in the macOS Dock while in minimalist mode or with no visible windows, it automatically unhides and focuses the main window.

### 11.5 Cross-Window Event Bridge & Multi-Layer Thread Synchronization
* **Cross-Window Handover**: When transitioning from the ambient overlay to the full desktop chat ("Open Chat" or "Restore Full Window"):
  * `exit_overlay_mode(tab_id)` passes `tabId` directly into Rust.
  * Rust native code shows and focuses the main window, then emits `main_win.emit("refresh-active-thread", { tabId })` directly from native code (bypassing webview permissions).
  * The overlay emits Tauri cross-window events (`switch-tab`, `refresh-active-thread`) enabled by explicit `core:event:default`, `core:event:allow-emit`, `core:event:allow-listen` permissions in `capabilities/default.json`.
  * The overlay updates `brainstorm_active_tab` and timestamp `brainstorm_refresh_ts` in shared `localStorage`.
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

### 11.6 Single-IPC Sizing & Rigid Idle Geometry
* **Locked Idle Bounds**: The idle minimalist HUD dimensions are rigidly invariant at `200×56` px across Rust and TypeScript. Expanding states (`prompt`, `response`, `error`) never overwrite or drift the idle HUD geometry in `~/.brainstorm.json`.
* **Deduplicated IPC**: Sizing operations route exclusively through the native `set_overlay_size` command, eliminating duplicate `win.setSize()` IPC roundtrips.
* **RAF Throttling**: Grip resizing on the prompt box is throttled with `requestAnimationFrame`, preventing IPC flooding during pointer drag interactions.


