/**
 * Database schema, embedded as a string so it survives `bun build --compile`
 * (a compiled sidecar cannot read schema.sql from the virtual source tree).
 * Keep in sync with schema.sql, which remains as reference for dev tooling.
 */
export const SCHEMA_SQL = `
-- Sequence counters for Base58 IDs
CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
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
    archived INTEGER NOT NULL DEFAULT 0,
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
    error INTEGER NOT NULL DEFAULT 0, -- 1 when the provider failed and content is a failure notice
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

-- Plugins (downloaded MCP servers / process plugins)
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
`;
