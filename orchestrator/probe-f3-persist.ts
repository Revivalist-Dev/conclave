// Probe for the F3 fix (a provider failure must be persisted as an errored row).
//
// DanyApiProvider's baseUrl is a hardcoded private field pointing at
// http://127.0.0.1:8000/v1, so the router is driven against a real HTTP stub
// bound to that address: one mode answers 500, the other answers a clean SSE
// stream. The database is redirected with CONCLAVE_DATA_DIR before `./src/db`
// is imported, so `orchestrator/data/conclave.db` is never opened.
//
// The temp database is pre-seeded with the pre-F3 `messages` table (no `error`
// column) and one historical row, so the guarded ALTER in initDatabase() is
// exercised on a database that genuinely predates the column.
//
//   bun orchestrator/probe-f3-persist.ts
//
// Three sections: migration, fail (provider 500), ok (clean stream).

import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync } from 'fs';
import { Database } from 'bun:sqlite';

const dataDir = join(tmpdir(), `conclave-f3-${Date.now()}`);
process.env.CONCLAVE_DATA_DIR = dataDir;
mkdirSync(dataDir, { recursive: true });

// --- A database created before the `error` column existed ------------------
const now = Date.now();
const legacy = new Database(join(dataDir, 'conclave.db'));
legacy.exec(`
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, directory_path TEXT, skills TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tabs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, last_response TEXT, last_model TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, attachments TEXT, model TEXT, usage TEXT, created_at INTEGER NOT NULL);
`);
legacy.prepare('INSERT INTO projects (id, name, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacyProj', 'Legacy', 'Folder', now, now);
legacy.prepare('INSERT INTO tabs (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('legacyTab', 'legacyProj', 'Old', now, now);
legacy.prepare('INSERT INTO messages (id, tab_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('legacyMsg', 'legacyTab', 'assistant', 'old answer', now);
legacy.close();

let mode: 'fail' | 'ok' = 'fail';

const server = Bun.serve({
	port: 8000,
	hostname: '127.0.0.1',
	fetch() {
		if (mode === 'fail') {
			return new Response(JSON.stringify({ detail: 'upstream exploded' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		const body =
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n' +
			'data: {"choices":[{"delta":{"content":" world"}}]}\n' +
			'data: {"usage":{"total_tokens":7}}\n' +
			'data: [DONE]\n\n';
		return new Response(body, {
			status: 200,
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}
});

const { initDatabase, repos, db } = await import('./src/db');
const { llmRouter } = await import('./src/router');

initDatabase();

console.log(`[probe] dataDir=${dataDir}`);

// --- Section 1: the guarded ALTER ran on a pre-existing database -----------
const columns = (db.query("SELECT name FROM pragma_table_info('messages')").all() as { name: string }[]).map((c) => c.name);
const legacyRow = (repos.getTabMessages('legacyTab') as any[]).at(-1);
console.log('\n[probe] case=migration');
console.log(JSON.stringify({ messageColumns: columns, legacyRow }, null, 2));

const projectId = (repos.getProjects()[0] as any).id as string;

async function drive(tabId: string, message: string) {
	const events: string[] = [];
	for await (const ev of llmRouter.streamChat({ tabId, message, provider: 'DeepSeek', model: 'deepseek-v4-flash' })) {
		events.push(ev.type);
	}
	const rows = repos.getTabMessages(tabId) as any[];
	const assistant = rows.filter((r) => r.role === 'assistant').at(-1);
	return {
		events,
		assistantRow: assistant
			? { role: assistant.role, error: assistant.error, content: assistant.content }
			: null,
		tabLastResponse: (repos.getTab(tabId) as any)?.last_response
	};
}

// --- Section 2: provider failure ------------------------------------------
mode = 'fail';
const failTab = repos.createTab(projectId, 'probe-fail').id;
const fail = await drive(failTab, 'hello');
console.log('\n[probe] case=fail');
console.log(JSON.stringify(fail, null, 2));

// --- Section 3: successful turn -------------------------------------------
mode = 'ok';
const okTab = repos.createTab(projectId, 'probe-ok').id;
const ok = await drive(okTab, 'hello');
console.log('\n[probe] case=ok');
console.log(JSON.stringify(ok, null, 2));

server.stop(true);
