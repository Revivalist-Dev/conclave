/**
 * Plugin manager: downloaded plugins that extend the orchestrator.
 *
 * v1 plugin types:
 *   - 'mcp'  — an MCP server spoken to over stdio (newline-delimited JSON-RPC).
 *              Its tools are aggregated into the orchestrator's MCP surface
 *              under namespaced names: plugin_<id>_<toolName>.
 *   - 'bun'  — a Bun process plugin (`bun run <entrypoint>` inside the plugin
 *              directory), health-checked on its declared port.
 *
 * Registry source of truth is the `plugins` table; files installed from git
 * live under <DATA_DIR>/plugins/<id>/. Everything here is writable at runtime,
 * even inside the read-only production sidecar.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, db, repos } from '../db';
import { supervisor } from '../processes/supervisor';
import { pluginBus } from './bus';
import { BUILTIN_PLUGINS } from './builtin';

export interface PluginManifest {
	id: string;
	name: string;
	version?: string;
	type: 'mcp' | 'bun' | 'docker';
	// 'mcp' (stdio transport): the plugin IS an MCP server — pure pass-through.
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// 'bun' process plugin
	entrypoint?: string; // run via `bun run <entrypoint>` in the plugin directory
	port?: number; // health-checked after spawn
	// 'docker' (executed by the supervisor's docker-compose flow)
	serviceName?: string;
	// MCP abilities scaffolded as JavaScript in the plugin directory — for
	// plugins (like DanyAPI) whose backend has no MCP server of its own.
	mcp?: {
		tools: Array<{ name: string; description: string; inputSchema: Record<string, any> }>;
		scaffold?: string; // JS module (relative to plugin dir) exporting call(toolName, args, ctx)
	};
	models?: Array<{ id: string; name?: string }>;
	files?: Record<string, string>; // built-in only: files seeded into the plugin dir
}

interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, any>;
}

const TOOL_PREFIX = 'plugin_';

/**
 * Speaks newline-delimited JSON-RPC to an MCP server child process over stdio.
 */
class McpStdioClient {
	private child: ChildProcess | null = null;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
	private nextId = 1;
	private buffer = '';
	tools: McpTool[] = [];
	status: 'starting' | 'running' | 'failed' | 'stopped' = 'starting';
	error: string | null = null;

	constructor(public manifest: PluginManifest) {}

	async start(): Promise<void> {
		if (!this.manifest.command) {
			throw new Error(`MCP plugin '${this.manifest.id}' is missing "command"`);
		}
		this.child = spawn(this.manifest.command, this.manifest.args || [], {
			env: { ...process.env, ...(this.manifest.env || {}) },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk));
		this.child.stderr?.on('data', (chunk: Buffer) => {
			const text = chunk.toString('utf-8').trim();
			if (text) console.log(`[Plugins:${this.manifest.id}] ${text}`);
		});
		this.child.on('exit', (code) => {
			if (this.status !== 'stopped') {
				this.status = 'failed';
				this.error = `MCP server process exited (code ${code ?? 'signal'})`;
			}
			this.child = null;
			this.rejectPending(`MCP server '${this.manifest.id}' process exited (code ${code ?? 'signal'})`);
		});

		await this.request(
			'initialize',
			{
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'brAInstorm-orchestrator', version: '0.1.0' }
			},
			15000
		);
		this.notify('notifications/initialized');

		const list = await this.request('tools/list', {}, 15000);
		this.tools = (list?.result?.tools || []).map((t: any) => ({
			name: t.name,
			description: t.description || '',
			inputSchema: t.inputSchema || { type: 'object', properties: {} }
		}));
		this.status = 'running';
		this.error = null;
	}

	private onData(chunk: Buffer) {
		this.buffer += chunk.toString('utf-8');
		let idx: number;
		while ((idx = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, idx).trim();
			this.buffer = this.buffer.slice(idx + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				if (msg.id !== undefined && this.pending.has(msg.id)) {
					const p = this.pending.get(msg.id)!;
					this.pending.delete(msg.id);
					clearTimeout(p.timer);
					p.resolve(msg);
				}
			} catch {
				// not JSON — ignore
			}
		}
	}

	request(method: string, params: any, timeoutMs = 30000): Promise<any> {
		if (!this.child?.stdin?.writable) {
			return Promise.reject(new Error('MCP server is not running'));
		}
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP request '${method}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	}

	notify(method: string) {
		this.child?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
	}

	private rejectPending(reason: string) {
		for (const [id, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new Error(reason));
		}
		this.pending.clear();
	}

	stop() {
		this.status = 'stopped';
		this.rejectPending(`MCP server '${this.manifest.id}' stopped`);
		this.child?.kill();
		this.child = null;
		this.tools = [];
	}
}

class PluginManager {
	private clients = new Map<string, McpStdioClient>();
	private processes = new Map<string, ChildProcess>();
	private scaffolds = new Map<string, { call: (toolName: string, args: any, ctx: any) => Promise<any> }>();
	// Live runtime state for process plugins (status/error, no tools)
	private procState = new Map<string, { status: string; error: string | null }>();

	get pluginsDir(): string {
		return join(DATA_DIR, 'plugins');
	}

	/** Re-spawn enabled plugins from the registry at orchestrator boot. */
	async restore(): Promise<void> {
		// Seed built-in plugin files (scaffolds) into the writable plugins dir:
		// missing files are restored every boot, user edits persist.
		for (const manifest of BUILTIN_PLUGINS) {
			const dir = join(this.pluginsDir, manifest.id);
			mkdirSync(dir, { recursive: true });
			for (const [name, content] of Object.entries(manifest.files || {})) {
				const target = join(dir, name);
				if (!existsSync(target)) writeFileSync(target, content, 'utf-8');
			}
		}

		// Built-in plugins (DanyAPI) sync into the registry on every boot; the
		// user's enabled choice is preserved across restarts.
		for (const manifest of BUILTIN_PLUGINS) {
			const existing = (repos.getPlugins() as any[]).find((p) => p.id === manifest.id);
			repos.upsertPlugin({
				id: manifest.id,
				name: manifest.name,
				type: manifest.type,
				enabled: existing ? !!existing.enabled : true,
				manifest: JSON.stringify(manifest),
				status: existing?.status || 'stopped',
				last_error: existing?.last_error ?? null
			});
		}

		for (const row of repos.getPlugins() as any[]) {
			if (!row.enabled) continue;
			try {
				await this.startPlugin(row.id, JSON.parse(row.manifest));
			} catch (err: any) {
				console.warn(`[Plugins] Failed to start '${row.id}': ${err.message}`);
				repos.setPluginStatus(row.id, 'failed', err.message);
			}
		}
	}

	async list(): Promise<any[]> {
		let dockerStatus = new Map<string, { status: string; error: string | null }>();
		try {
			for (const s of supervisor.getStatus()) {
				dockerStatus.set(s.name, { status: s.status, error: s.error || null });
			}
		} catch {}

		return (repos.getPlugins() as any[]).map((row) => {
			const client = this.clients.get(row.id);
			const proc = this.procState.get(row.id);
			let status = client ? client.status : proc?.status || row.status;
			let error = client ? client.error : proc?.error || row.last_error;

			let manifest: PluginManifest | null = null;
			try {
				manifest = JSON.parse(row.manifest);
			} catch {}

			if (manifest?.type === 'docker') {
				const svc = dockerStatus.get(manifest.serviceName || 'DanyAPI');
				if (svc) {
					status = svc.status;
					error = svc.error;
				}
			}

			return {
				id: row.id,
				name: row.name,
				type: row.type,
				enabled: !!row.enabled,
				status,
				error: status === 'failed' ? error : null,
				tools: client?.tools || manifest?.mcp?.tools || [],
				models: manifest?.models || []
			};
		});
	}

	/** Install a plugin from a git URL: clone into plugins/<id>, read plugin.json. */
	async installFromGit(url: string): Promise<PluginManifest> {
		const id = (url.split('/').pop() || 'plugin').replace(/\.git$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
		mkdirSync(this.pluginsDir, { recursive: true });
		const dir = join(this.pluginsDir, id);
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
		const res = spawnSync('git', ['clone', '--depth', '1', url, dir], {
			encoding: 'utf-8',
			timeout: 60000
		});
		if (res.status !== 0 || !existsSync(dir)) {
			throw new Error(res.stderr?.trim() || 'git clone failed');
		}
		const manifestPath = join(dir, 'plugin.json');
		if (!existsSync(manifestPath)) {
			rmSync(dir, { recursive: true, force: true });
			throw new Error('Repository has no plugin.json manifest');
		}
		const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		manifest.id = manifest.id || id;
		await this.register(manifest);
		return manifest;
	}

	/** Register an inline manifest (e.g. a locally-run MCP server command). */
	async register(manifest: PluginManifest) {
		if (!manifest.id || !manifest.name || !manifest.type) {
			throw new Error('Plugin manifest requires id, name and type');
		}
		repos.upsertPlugin({
			id: manifest.id,
			name: manifest.name,
			type: manifest.type,
			enabled: true,
			manifest: JSON.stringify(manifest),
			status: 'stopped',
			last_error: null
		});
		await this.startPlugin(manifest.id, manifest);
	}

	async remove(id: string) {
		this.stop(id);
		repos.deletePlugin(id);
		const dir = join(this.pluginsDir, id);
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	async toggle(id: string, enabled: boolean) {
		const row = (repos.getPlugins() as any[]).find((p) => p.id === id);
		if (!row) throw new Error(`Unknown plugin: ${id}`);
		const manifest: PluginManifest = JSON.parse(row.manifest);
		db.prepare('UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?')
			.run(enabled ? 1 : 0, Date.now(), id);
		if (enabled) {
			if (manifest.type === 'docker') {
				repos.setSetting('deepseek_enabled', 'true');
			}
			await this.startPlugin(id, manifest);
		} else {
			if (manifest.type === 'docker') {
				// Docker providers opt out via their provider-enabled setting so the
				// supervisor skips them on the next boot.
				repos.setSetting('deepseek_enabled', 'false');
			}
			this.stop(id);
		}
	}

	/** All plugin tools, namespaced into the orchestrator MCP surface. */
	listMcpTools(): McpTool[] {
		const out: McpTool[] = [];
		for (const [id, client] of this.clients) {
			if (client.status !== 'running') continue;
			for (const tool of client.tools) {
				out.push({
					name: `${TOOL_PREFIX}${id}_${tool.name}`,
					description: `[${client.manifest.name}] ${tool.description}`.trim(),
					inputSchema: tool.inputSchema
				});
			}
		}
		// Scaffolded MCP abilities (JS authored in the plugin directory)
		for (const row of repos.getPlugins() as any[]) {
			let manifest: PluginManifest | null = null;
			try {
				manifest = JSON.parse(row.manifest);
			} catch {
				continue;
			}
			if (!manifest?.mcp?.tools?.length) continue;
			if (!this.scaffolds.get(manifest.id)) continue; // scaffold loaded = runtime up
			for (const tool of manifest.mcp.tools) {
				out.push({
					name: `${TOOL_PREFIX}${manifest.id}_${tool.name}`,
					description: `[${manifest.name}] ${tool.description}`.trim(),
					inputSchema: tool.inputSchema
				});
			}
		}
		return out;
	}

	/** Whether a (non-mcp) plugin's runtime is currently up. */
	private manifestRunning(manifest: PluginManifest): boolean {
		if (manifest.type === 'docker') {
			const svc = supervisor
				.getStatus()
				.find((s: any) => s.name === (manifest.serviceName || 'DanyAPI'));
			return svc?.status === 'running';
		}
		return this.procState.get(manifest.id)?.status === 'running';
	}

	/**
	 * Route a namespaced or aliased tools/call: a plugin's tool relays to that plugin's
	 * server/handler; anything else falls through to the built-in tools.
	 */
	async callTool(name: string, args: any): Promise<{ content: any[]; isError?: boolean } | null> {
		// Longest owning prefix wins, so plugin ids that prefix each other can't misroute.
		const candidates: {
			prefix: string;
			owns: boolean;
			run: () => Promise<{ content: any[]; isError?: boolean }>;
		}[] = [];

		for (const [id, client] of this.clients) {
			const prefix = `${TOOL_PREFIX}${id}_`;
			const isPrefixed = name.startsWith(prefix);
			const toolName = isPrefixed ? name.slice(prefix.length) : name;
			const owns = client.status === 'running' && client.tools.some((t) => t.name === toolName);
			if (isPrefixed || owns) {
				candidates.push({
					prefix: isPrefixed ? prefix : '',
					owns,
					run: async () => {
						const res = await client.request('tools/call', { name: toolName, arguments: args });
						if (res?.error) {
							return {
								content: [{ type: 'text', text: res.error.message || 'Plugin tool error' }],
								isError: true
							};
						}
						return res?.result ?? { content: [{ type: 'text', text: 'Empty response' }] };
					}
				});
			}
		}

		for (const row of repos.getPlugins() as any[]) {
			let manifest: PluginManifest | null = null;
			try {
				manifest = JSON.parse(row.manifest);
			} catch {
				continue;
			}
			if (!manifest?.mcp?.tools?.length) continue;
			const scaffold = this.scaffolds.get(manifest.id);
			if (!scaffold) continue;
			const prefix = `${TOOL_PREFIX}${manifest.id}_`;
			const isPrefixed = name.startsWith(prefix);
			const toolName = isPrefixed ? name.slice(prefix.length) : name;
			const owns = manifest.mcp.tools.some((t) => t.name === toolName);
			if (isPrefixed || owns) {
				const ctx = this.scaffoldContext(manifest);
				candidates.push({
					prefix: isPrefixed ? prefix : '',
					owns,
					run: async () => {
						const res = await scaffold.call(toolName, args, ctx);
						if (typeof res === 'string') return { content: [{ type: 'text', text: res }] };
						return res ?? { content: [{ type: 'text', text: 'Empty response' }] };
					}
				});
			}
		}

		candidates.sort((a, b) => b.prefix.length - a.prefix.length);
		for (const candidate of candidates) {
			if (!candidate.owns) continue;
			return candidate.run();
		}
		return {
			content: [{ type: 'text', text: `Unknown plugin tool: ${name}` }],
			isError: true
		};
	}

	private async startPlugin(id: string, manifest: PluginManifest) {
		if (manifest.type === 'mcp') {
			const client = new McpStdioClient(manifest);
			this.clients.set(id, client);
			try {
				await client.start();
				console.log(`[Plugins] '${id}' running — ${client.tools.length} MCP tool(s)`);
			} catch (err: any) {
				client.status = 'failed';
				client.error = err.message;
				repos.setPluginStatus(id, 'failed', err.message);
				throw err;
			}
			repos.setPluginStatus(id, 'running', null);
		} else if (manifest.type === 'bun') {
			const dir = join(this.pluginsDir, id);
			if (!existsSync(dir)) {
				const error = `bun plugin '${id}' has no installed directory`;
				this.procState.set(id, { status: 'failed', error });
				repos.setPluginStatus(id, 'failed', error);
				throw new Error(error);
			}
			const child = spawn('bun', ['run', manifest.entrypoint || 'index.ts'], {
				cwd: dir,
				env: { ...process.env, ...(manifest.env || {}) },
				stdio: 'ignore'
			});
			this.processes.set(id, child);
			this.procState.set(id, { status: 'starting', error: null });
			child.on('exit', (code) => {
				this.procState.set(id, { status: 'failed', error: `process exited (code ${code ?? 'signal'})` });
				repos.setPluginStatus(id, 'failed', `process exited (code ${code ?? 'signal'})`);
				this.processes.delete(id);
			});
			const healthy = await this.waitHealthy(manifest.port, 15000);
			if (healthy) {
				this.procState.set(id, { status: 'running', error: null });
				repos.setPluginStatus(id, 'running', null);
				console.log(`[Plugins] '${id}' running on port ${manifest.port}`);
			} else {
				const error = manifest.port ? `port ${manifest.port} never became healthy` : 'no port declared to health-check';
				this.procState.set(id, { status: 'failed', error });
				repos.setPluginStatus(id, 'failed', error);
			}
		} else if (manifest.type === 'docker') {
			// Docker plugins are executed by the supervisor's docker-compose flow.
			const service = manifest.serviceName || 'DanyAPI';
			try {
				await supervisor.startService(service);
			} catch (err: any) {
				console.warn(`[Plugins] Could not start docker service '${service}': ${err.message}`);
			}
			const live = supervisor.getStatus().find((s: any) => s.name === service);
			const status = live?.status || 'stopped';
			this.procState.set(id, { status, error: live?.error || null });
			repos.setPluginStatus(id, status, live?.error || null);
			console.log(`[Plugins] '${id}' docker service '${service}': ${status}`);
		} else {
			throw new Error(`Unsupported plugin type: ${manifest.type}`);
		}

		// MCP abilities scaffolded as JS in the plugin directory (DanyAPI-style
		// plugins whose backend has no MCP server of its own).
		if (manifest.mcp?.scaffold) {
			await this.loadScaffold(id, manifest);
		}
	}

	private async loadScaffold(id: string, manifest: PluginManifest) {
		const file = join(this.pluginsDir, id, manifest.mcp?.scaffold || 'mcp.js');
		if (!existsSync(file)) {
			console.warn(`[Plugins] '${id}' MCP scaffold '${manifest.mcp?.scaffold}' not found`);
			return;
		}
		try {
			const mod = await import(pathToFileURL(file).href);
			const call = mod.call || mod.default?.call;
			if (typeof call !== 'function') {
				console.warn(`[Plugins] '${id}' scaffold has no call(toolName, args, ctx) export`);
				return;
			}
			this.scaffolds.set(id, { call });
			console.log(`[Plugins] '${id}' MCP scaffold loaded (${manifest.mcp?.tools?.length || 0} tool(s))`);
		} catch (err: any) {
			console.warn(`[Plugins] Failed to load scaffold for '${id}': ${err.message}`);
		}
	}

	/** API surface handed to plugin scaffolds — thin, persistence-aware helpers. */
	private scaffoldContext(manifest: PluginManifest) {
		return {
			setting: (key: string, fallback = '') => repos.getSetting(key) ?? fallback,
			getOrCreateThread: (name: string) => {
				const existing = (repos.getAllTabs() as any[]).find((t) => t.name.toLowerCase() === name.toLowerCase());
				if (existing) return existing;
				const project = (repos.getProjects() as any[])[0];
				if (!project) throw new Error('No project available to open a thread');
				const tab = repos.createTab(project.id, name);
				pluginBus.emit('tab-created', { tab });
				return tab;
			},
			addMessage: (tabId: string, role: 'user' | 'assistant', content: string, model?: string) => {
				repos.addMessage(tabId, role, content, undefined, model);
				repos.updateTabLastResponse(tabId, String(content).slice(0, 200), model);
				pluginBus.emit('tab-updated', { tabId });
			},
			getMessages: (tabId: string) => repos.getTabMessages(tabId) as any[],
			log: (...parts: any[]) => console.log(`[Plugin:${manifest.id}]`, ...parts)
		};
	}

	private stop(id: string) {
		const client = this.clients.get(id);
		if (client) {
			client.stop();
			this.clients.delete(id);
		}
		const proc = this.processes.get(id);
		if (proc) {
			proc.kill();
			this.processes.delete(id);
		}
		this.scaffolds.delete(id);
		this.procState.set(id, { status: 'stopped', error: null });
		repos.setPluginStatus(id, 'stopped', null);
	}

	private async waitHealthy(port: number | undefined, timeoutMs: number): Promise<boolean> {
		if (!port) return false;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
				if (res.ok || res.status === 404) return true; // 404 still means "alive"
			} catch {}
			await new Promise((r) => setTimeout(r, 500));
		}
		return false;
	}
}

export const pluginManager = new PluginManager();
