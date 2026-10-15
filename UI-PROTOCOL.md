# Conclave UI & Orchestrator Communication Protocol

This document defines the WebSocket and HTTP communication protocol between the client (Tauri Desktop App / Web UI) and the Conclave Orchestrator (Bun runtime on port 4000).

---

## 1. Overview & Architecture

```
┌───────────────────────────────┐
│     Client UI (SvelteKit)     │
│    (Tauri Desktop / Browser)  │
└───────────────┬───────────────┘
                │
         WebSocket (ws://127.0.0.1:4000/ws)
         HTTP Fallback (http://127.0.0.1:4000)
                │
┌───────────────▼───────────────┐
│    Conclave Orchestrator    │
│    (Bun Backend on Port 4000) │
└───────┬───────────────┬───────┘
        │               │
  SQLite Database  Docker Compose LLM Containers
 (conclave.db)   (DanyAPI / Port 8000)
```

- **Transport**: JSON over WebSocket (`ws://127.0.0.1:4000/ws`).
- **Encoding**: UTF-8 JSON payloads with a required `type` field.
- **Identifers**: Compact, URL-safe Base58 IDs:
  - Project ID: 3 Base58 chars (e.g. `112`)
  - Tab ID: 4 Base58 chars (e.g. `1112`)
  - Message ID: 12 Base58 chars (Tab ID + timestamp + random)

---

## 2. Startup Handshake & Environment Synchronization

To prevent premature data transfers or double loading, connection establishment follows a strict, sequential handshake.

```
Client UI                                    Orchestrator
   │                                              │
   │ ─── 1. TCP / WebSocket Connect ───────────> │
   │                                              │
   │ <── 2. SERVER_READY (handshake ack) ──────── │
   │                                              │
   │ ─── 3. LOAD_SETTINGS (client ack & req) ───> │
   │                                              │
   │ <── 4. SETTINGS_LOADED (environment sync) ── │
   │                                              │
   │ ─── 5. TAB_FETCH (hydrate active tab) ─────> │
   │                                              │
   │ <── 6. TAB_DETAIL (messages for tab) ─────── │
```

### Step 1: `SERVER_READY` (Orchestrator → Client)
Immediately upon accepting a client WebSocket connection, the orchestrator emits a lightweight readiness acknowledgement. It does **not** dump all data eagerly.

```json
{
  "type": "SERVER_READY",
  "serverVersion": "0.1.0",
  "status": "ready"
}
```

### Step 2: `LOAD_SETTINGS` (Client → Orchestrator)
Upon receiving `SERVER_READY`, the client acknowledges the connection and requests its full environment (projects, tabs, models, settings, and service health).

```json
{
  "type": "LOAD_SETTINGS",
  "clientVersion": "0.1.0"
}
```

### Step 3: `SETTINGS_LOADED` (Orchestrator → Client)
The orchestrator queries SQLite and provider plugins, then transmits the full workspace environment.

```json
{
  "type": "SETTINGS_LOADED",
  "projects": [
    {
      "id": "112",
      "name": "Discussions",
      "icon": "MessagesSquare",
      "directory_path": null,
      "created_at": 1789146518484,
      "updated_at": 1789146518484
    }
  ],
  "tabs": [
    {
      "id": "1112",
      "project_id": "112",
      "name": "New Conversation",
      "last_response": "Hello! ...",
      "last_model": "deepseek-v4-flash",
      "created_at": 1789146518484,
      "updated_at": 1789149419108
    }
  ],
  "models": [
    { "id": "deepseek-v4-flash", "name": "Deepseek v4", "description": "Fast reasoning & chat", "provider": "DeepSeek" },
    { "id": "deepseek-v4-flash-thinking", "name": "DeepSeek V4 Thinking", "description": "Deep thinking reasoning process", "provider": "DeepSeek" },
    { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "description": "High capability deep model", "provider": "DeepSeek" },
    { "id": "deepseek-v4-pro-thinking", "name": "DeepSeek V4 Pro Thinking", "description": "Maximum reasoning & reflection", "provider": "DeepSeek" },
    { "id": "qwen3.7-plus", "name": "Qwen 3.7 Plus", "description": "Multimodal & vision analysis", "provider": "Qwen" },
    { "id": "qwen3.8-max", "name": "Qwen 3.8 Max", "description": "Frontier multimodal coder", "provider": "Qwen" }
  ],
  "settings": {
    "temperature": "0.7",
    "max_tokens": "4096",
    "active_provider": "deepseek"
  },
  "services": [
    { "name": "DanyAPI", "port": 8000, "status": "running", "type": "docker" }
  ]
}
```

---

## 3. Tab Message Hydration (`TAB_FETCH` & `TAB_DETAIL`)

Tabs contain lightweight metadata in `SETTINGS_LOADED` (title, project ID, timestamps). Message history is loaded on demand for the active tab.

### What is `TAB_FETCH`?
When the client determines which tab is open (or when the user switches tabs), it sends `TAB_FETCH` with a time filter (default: last 7 days).

```json
{
  "type": "TAB_FETCH",
  "tabId": "1112",
  "days": 7
}
```

### What is `TAB_DETAIL`?
`TAB_DETAIL` is the orchestrator's response containing the chronological list of messages, tool steps, attachments, and token usage for that tab.

```json
{
  "type": "TAB_DETAIL",
  "tabId": "1112",
  "messages": [
    {
      "id": "111218f0a2b1c",
      "tab_id": "1112",
      "role": "user",
      "content": "Can you check the database schema?",
      "attachments": null,
      "model": "deepseek-v4-flash",
      "created_at": 1789146600000
    },
    {
      "id": "111218f0a2b9f",
      "tab_id": "1112",
      "role": "assistant",
      "content": "The database contains projects, tabs, and messages tables...",
      "attachments": null,
      "model": "deepseek-v4-flash",
      "totalTokens": 334,
      "tool_steps": [],
      "created_at": 1789146605000
    }
  ]
}
```

---

## 4. Tab & Project Management

### Create Tab
- **Client sends**:
  ```json
  { "type": "TAB_CREATE", "projectId": "112", "name": "Refactor Auth" }
  ```
- **Orchestrator responds**:
  ```json
  { "type": "TAB_CREATED", "tab": { "id": "1113", "project_id": "112", "name": "Refactor Auth", ... } }
  ```

### Rename Tab
- **Client sends**:
  ```json
  { "type": "TAB_RENAME", "tabId": "1113", "name": "Refactor Auth V2" }
  ```
- **Orchestrator responds**:
  ```json
  { "type": "TAB_RENAMED", "tabId": "1113", "name": "Refactor Auth V2" }
  ```

### Delete Tab
- **Client sends**:
  ```json
  { "type": "TAB_DELETE", "tabId": "1113" }
  ```
- **Orchestrator responds**:
  ```json
  { "type": "TAB_DELETED", "tabId": "1113" }
  ```

### Create Project
- **Client sends**:
  ```json
  { "type": "PROJECT_CREATE", "name": "Backend API", "directoryPath": "/Code/api" }
  ```
- **Orchestrator responds**:
  ```json
  { "type": "PROJECT_CREATED", "project": { "id": "113", "name": "Backend API", ... } }
  ```

---

## 5. Chat & Streaming Execution Lifecycle

When the user submits a prompt:

### Step 1: `PROMPT_SEND` (Client → Orchestrator)
```json
{
  "type": "PROMPT_SEND",
  "tabId": "1112",
  "content": "Optimize the database query",
  "provider": "DeepSeek",
  "model": "deepseek-v4-flash",
  "attachments": []
}
```

### Step 2: Streaming Events (Orchestrator → Client)
The orchestrator streams events as they arrive from the LLM engine:

1. **Token Delta (`CHAT_TOKEN`)**:
   ```json
   { "type": "CHAT_TOKEN", "tabId": "1112", "token": "Here " }
   ```
2. **Tool Execution Step (`TOOL_STEP_UPDATE`)**:
   ```json
   {
     "type": "TOOL_STEP_UPDATE",
     "tabId": "1112",
     "step": { "title": "Inspecting schema.sql", "status": "done", "badgeCount": 1 }
   }
   ```
3. **Usage Update (`CHAT_USAGE`)**:
   ```json
   { "type": "CHAT_USAGE", "tabId": "1112", "totalTokens": 334, "model": "deepseek-v4-flash" }
   ```
4. **Completion (`CHAT_COMPLETE`)**:
   ```json
   {
     "type": "CHAT_COMPLETE",
     "tabId": "1112",
     "messageId": "111218f0a3cc4",
     "totalTokens": 334,
     "model": "deepseek-v4-flash"
   }
   ```
5. **Error Notification (`CHAT_ERROR`)**:
   ```json
   { "type": "CHAT_ERROR", "tabId": "1112", "error": "Connection timed out" }
   ```

---

## 6. Model Discovery & Token Usage Display

Models are **not hardcoded** in either the UI or orchestrator core.

1. **Provider Plugin Declaration**:
   Each LLM provider plugin (e.g. `orchestrator/src/providers/danyapi.ts`) defines an array:
   ```typescript
   export const DANYAPI_MODELS: ModelDescriptor[] = [
     { id: 'deepseek-v4-flash', name: 'Deepseek v4', description: 'Fast reasoning & chat' },
     { id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', description: 'Multimodal & vision analysis' }
   ];
   ```
2. **UI Mapping**:
   The UI receives this array in `SETTINGS_LOADED`. When rendering the token badge, it looks up the name by ID:
   ```typescript
   function getModelName(modelId?: string): string {
     if (!modelId) return harness.availableModels[0]?.name || 'Deepseek v4';
     const found = harness.availableModels.find((m) => m.id === modelId);
     return found ? found.name : modelId;
   }
   ```
   Renders:
   `Deepseek v4 tokens used: 334`

---

## 7. HTTP Endpoints

In addition to WebSockets, the orchestrator exposes HTTP REST endpoints for fallback and file uploads:

| Endpoint | Method | Description |
|---|---|---|
| `/api/settings/load` | `GET` | Returns projects, tabs, models, settings, and service status (HTTP fallback) |
| `/api/tabs` | `GET` | Returns list of all tabs |
| `/api/tabs/:id/messages` | `GET` | Returns message history for a tab (`?days=7`) |
| `/api/upload` | `POST` | Multipart file upload staging (`file`, `session_id`, `model`) |
| `/mcp` | `POST` | JSON-RPC 2.0 endpoint for Model Context Protocol tools |
| `/health` | `GET` | Supervisor and service health check |
