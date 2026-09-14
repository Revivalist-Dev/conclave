import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { newProjectId, newTabId, newMessageId, newToolStepId } from './helper';
import { SCHEMA_SQL } from './schema';

// BRAINSTORM_DATA_DIR is set by the Tauri sidecar loader in production so the
// database lives in the OS app-data dir; dev falls back to the repo data dir
// (a compiled sidecar cannot resolve paths via import.meta.dir).
export const DATA_DIR = process.env.BRAINSTORM_DATA_DIR || join(import.meta.dir, '../../data');
const DB_PATH = join(DATA_DIR, 'brainstorm.db');

if (!existsSync(DATA_DIR)) {
	mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Sequential counter helper
export function nextSeq(name: string): number {
	const row = db.query('SELECT value FROM counters WHERE name = ?').get(name) as { value: number } | null;
	const next = row ? row.value + 1 : 1;
	db.prepare('INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)').run(name, next);
	return next;
}

// Initialize schema
export function initDatabase() {
	db.exec(SCHEMA_SQL);

	// Migrations for databases created before a column existed
	try {
		db.exec('ALTER TABLE tabs ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
	} catch {
		// column already exists
	}

	// Migrate legacy 'General' project name to 'Discussions' with 'MessagesSquare' icon
	db.prepare("UPDATE projects SET name = 'Discussions', icon = 'MessagesSquare' WHERE name = 'General'").run();

	// Seed default data if empty
	const projectCount = (db.query('SELECT count(*) as count FROM projects').get() as { count: number }).count;
	if (projectCount === 0) {
		const now = Date.now();

		// Create default placeholder project 'Discussions'
		const projId1 = newProjectId(nextSeq('project'));
		db.prepare(
			'INSERT INTO projects (id, name, icon, directory_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
		).run(projId1, 'Discussions', 'MessagesSquare', null, now, now);

		// Create default tab under 'Discussions'
		const tabId = newTabId(nextSeq('tab'));
		db.prepare(
			'INSERT INTO tabs (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		).run(tabId, projId1, 'New Conversation', now, now);

		// Seed default settings
		const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
		insertSetting.run('temperature', '0.7', now);
		insertSetting.run('max_tokens', '4096', now);
		insertSetting.run('active_provider', 'deepseek', now);
		insertSetting.run('deepseek_enabled', 'true', now);
		insertSetting.run('deepseek_endpoint', 'http://127.0.0.1:8000/v1', now);
		insertSetting.run('deepseek_model', 'deepseek-v4-flash', now);
		insertSetting.run('mcp_enabled', 'true', now);
		insertSetting.run('danyapi_port', '8000', now);
	}
}

// Data access helpers
export const repos = {
	// === Plugins ===
	getPlugins: () => db.query('SELECT * FROM plugins ORDER BY created_at ASC').all() as any[],
	upsertPlugin: (p: { id: string; name: string; type: string; enabled: boolean; manifest: string; status: string; last_error: string | null }) => {
		const now = Date.now();
		db.prepare(
			`INSERT OR REPLACE INTO plugins (id, name, type, enabled, manifest, status, last_error, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM plugins WHERE id = ?), ?), ?)`
		).run(p.id, p.name, p.type, p.enabled ? 1 : 0, p.manifest, p.status, p.last_error, p.id, now, now);
	},
	deletePlugin: (id: string) => db.prepare('DELETE FROM plugins WHERE id = ?').run(id),
	setPluginStatus: (id: string, status: string, lastError?: string | null) => {
		db.prepare('UPDATE plugins SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
			.run(status, lastError ?? null, Date.now(), id);
	},

	// === Projects ===
	createProject: (name: string, directoryPath?: string, skills?: string[], metadata?: any, icon = 'Folder') => {
		const id = newProjectId(nextSeq('project'));
		const now = Date.now();
		db.prepare(
			'INSERT INTO projects (id, name, icon, directory_path, skills, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		).run(id, name, icon, directoryPath || null, skills ? JSON.stringify(skills) : null, metadata ? JSON.stringify(metadata) : null, now, now);
		return { id, name, icon, directory_path: directoryPath, skills, metadata, created_at: now, updated_at: now };
	},
	getProject: (projectId: string) => {
		const proj = db.query('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
		if (proj) {
			if (proj.skills) try { proj.skills = JSON.parse(proj.skills); } catch {}
			if (proj.metadata) try { proj.metadata = JSON.parse(proj.metadata); } catch {}
		}
		return proj;
	},
	getProjects: () => {
		const rows = db.query('SELECT * FROM projects ORDER BY created_at ASC').all() as any[];
		for (const r of rows) {
			if (r.skills) try { r.skills = JSON.parse(r.skills); } catch {}
			if (r.metadata) try { r.metadata = JSON.parse(r.metadata); } catch {}
		}
		return rows;
	},
	deleteProject: (projectId: string) => {
		db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
	},

	// === Tabs ===
	createTab: (projectId: string, name = 'New Conversation') => {
		const id = newTabId(nextSeq('tab'));
		const now = Date.now();
		db.prepare(
			'INSERT INTO tabs (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		).run(id, projectId, name, now, now);
		return { id, project_id: projectId, name, last_response: null, last_model: null, created_at: now, updated_at: now };
	},
	deleteTab: (tabId: string) => {
		db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId);
	},
	getTab: (tabId: string) => {
		return db.query('SELECT * FROM tabs WHERE id = ?').get(tabId) as any;
	},
	getProjectTabs: (projectId: string) => {
		return db.query('SELECT * FROM tabs WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[];
	},
	getAllTabs: () => {
		return db.query('SELECT * FROM tabs ORDER BY updated_at DESC').all() as any[];
	},
	getConversations: () => {
		return db.query('SELECT * FROM tabs ORDER BY updated_at DESC').all() as any[];
	},
	renameTab: (tabId: string, name: string) => {
		const now = Date.now();
		db.prepare('UPDATE tabs SET name = ?, updated_at = ? WHERE id = ?').run(name, now, tabId);
	},
	setTabArchived: (tabId: string, archived: boolean) => {
		const now = Date.now();
		db.prepare('UPDATE tabs SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, tabId);
	},
	updateTabLastResponse: (tabId: string, snippet: string, model?: string) => {
		const now = Date.now();
		db.prepare('UPDATE tabs SET last_response = ?, last_model = ?, updated_at = ? WHERE id = ?')
			.run(snippet.slice(0, 200), model || null, now, tabId);
	},
	ensureTab: (tabId: string, projectId?: string) => {
		const existing = db.query('SELECT id FROM tabs WHERE id = ?').get(tabId);
		if (!existing) {
			const defaultProj = db.query('SELECT id FROM projects ORDER BY created_at ASC LIMIT 1').get() as any;
			const projId = projectId || defaultProj?.id;
			if (!projId) return;
			const now = Date.now();
			db.prepare(
				'INSERT OR IGNORE INTO tabs (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
			).run(tabId, projId, 'New Conversation', now, now);
		}
	},

	// === Messages ===
	addMessage: (tabId: string, role: 'user' | 'assistant' | 'system', content: string, attachments?: any[], model?: string, usage?: any) => {
		repos.ensureTab(tabId);
		const id = newMessageId(tabId);
		const now = Date.now();
		db.prepare(
			'INSERT INTO messages (id, tab_id, role, content, attachments, model, usage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		).run(id, tabId, role, content, attachments?.length ? JSON.stringify(attachments) : null, model || null, usage ? JSON.stringify(usage) : null, now);
		db.prepare('UPDATE tabs SET updated_at = ? WHERE id = ?').run(now, tabId);
		return { id, tab_id: tabId, role, content, attachments, model, usage, created_at: now };
	},
	getTabMessages: (tabId: string, days?: number) => {
		let messages: any[] = [];
		if (typeof days === 'number' && days > 0) {
			const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
			messages = db.query(
				'SELECT * FROM messages WHERE tab_id = ? AND created_at >= ? ORDER BY created_at ASC'
			).all(tabId, cutoff) as any[];
			// If no messages in the last `days` days, fallback to the latest 50 messages so the tab isn't blank
			if (messages.length === 0) {
				messages = db.query(
					'SELECT * FROM messages WHERE tab_id = ? ORDER BY created_at DESC LIMIT 50'
				).all(tabId) as any[];
				messages.reverse();
			}
		} else {
			messages = db.query('SELECT * FROM messages WHERE tab_id = ? ORDER BY created_at ASC').all(tabId) as any[];
		}

		for (const msg of messages) {
			if (msg.attachments && typeof msg.attachments === 'string') {
				try { msg.attachments = JSON.parse(msg.attachments); } catch {}
			}
			if (msg.usage && typeof msg.usage === 'string') {
				try {
					msg.usage = JSON.parse(msg.usage);
					if (msg.usage?.totalTokens !== undefined) msg.totalTokens = msg.usage.totalTokens;
				} catch {}
			}
			if (msg.role === 'assistant') {
				msg.tool_steps = db.query('SELECT * FROM tool_steps WHERE message_id = ? ORDER BY created_at ASC').all(msg.id);
				for (const step of msg.tool_steps) {
					if (typeof step.details === 'string') {
						try { step.details = JSON.parse(step.details); } catch {}
					}
				}
			}
		}
		return messages;
	},

	// === Tool Steps ===
	addToolStep: (messageId: string, title: string, badgeCount: number, status: 'running' | 'done' | 'error', details: any) => {
		const id = newToolStepId();
		const now = Date.now();
		db.prepare(
			'INSERT INTO tool_steps (id, message_id, title, badge_count, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(id, messageId, title, badgeCount, status, JSON.stringify(details), now);
		return { id, message_id: messageId, title, badge_count: badgeCount, status, details, created_at: now };
	},

	// === Settings ===
	getSettings: () => {
		const rows = db.query('SELECT key, value FROM settings').all() as { key: string; value: string }[];
		const result: Record<string, string> = {};
		for (const r of rows) result[r.key] = r.value;
		return result;
	},
	getSetting: (key: string): string | null => {
		const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null;
		return row?.value ?? null;
	},
	setSetting: (key: string, value: string) => {
		const now = Date.now();
		db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, now);
	},
	isDeepSeekEnabled: (): boolean => {
		const row = db.query("SELECT value FROM settings WHERE key = 'deepseek_enabled'").get() as { value: string } | null;
		if (row) return row.value === 'true' || row.value === '1';
		return true;
	},
	getDeepSeekConfig: () => {
		const endpoint = (db.query("SELECT value FROM settings WHERE key = 'deepseek_endpoint'").get() as any)?.value || 'http://127.0.0.1:8000/v1';
		const model = (db.query("SELECT value FROM settings WHERE key = 'deepseek_model'").get() as any)?.value || 'deepseek-v4-flash';
		return { endpoint, model };
	}
};

