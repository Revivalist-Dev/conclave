import { runBootstrap } from './bootstrap';
import { supervisor } from './processes/supervisor';
import { mcpServer } from './mcp';
import { pluginManager } from './plugins';
import { pluginBus } from './plugins/bus';
import { llmRouter } from './router';
import { repos, db } from './db';
import { getAllAvailableModels } from './providers';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { publicBootstrap, redactServiceErrors, sanitizeDiagnostic } from './surface';

const PORT = Number(process.env.PORT) || 4000;

// Execute bootstrap sequence
console.log('-----------------------------------------------------');
console.log('[Orchestrator] Conclave Orchestrator starting...');
console.log('-----------------------------------------------------');

const bootstrap = await runBootstrap();
supervisor.startAll();
pluginManager.restore().catch((e) => console.warn('[Plugins] Restore failed:', e));

// Plugin-generated threads (e.g. DanyAPI ask_* MCP threads) announce themselves
// so open windows refresh the conversation.
pluginBus.on('tab-created', ({ tab }) => {
	broadcastWs({
		type: 'TAB_CREATED',
		tab
	}, `tabId="${tab?.id}"`);
});

pluginBus.on('tab-updated', ({ tabId }) => {
	broadcastWs({
		type: 'TAB_UPDATED',
		tabId
	}, `tabId="${tabId}"`);
});

/**
 * Best-effort: ask every provider backend that may host this thread's
 * server-side session to delete it (DELETE <endpoint>/v1/session/<tabId>).
 * Failures are ignored — the local thread is deleted regardless.
 */
function deleteProviderSessions(tabId: string): void {
	const endpoints: string[] = [];
	try {
		if (repos.isDeepSeekEnabled()) {
			const endpoint = String(repos.getSetting('deepseek_endpoint') || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
			endpoints.push(endpoint);
		}
	} catch {}

	for (const endpoint of endpoints) {
		fetch(`${endpoint}/session/${encodeURIComponent(tabId)}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(3000)
		})
			.then((res) => console.log(`[Tabs] Provider session delete ${tabId} @ ${endpoint}: ${res.status}`))
			.catch(() => console.log(`[Tabs] Provider session delete ${tabId} @ ${endpoint}: unreachable (ignored)`));
	}
}

// Models exposed directly from active provider plugins
export const AVAILABLE_MODELS = getAllAvailableModels();

const connectedClients = new Set<any>();

export function broadcastWs(payload: any, detail?: string) {
	const json = JSON.stringify(payload);
	const bytes = Buffer.byteLength(json, 'utf-8');
	const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
	const desc = detail ? ` (${sizeStr}: ${detail})` : ` (${sizeStr})`;
	console.log(`[WebSocket] Broadcast -> (${connectedClients.size} clients) [${payload.type}]${desc}`);
	for (const client of connectedClients) {
		try {
			if (client.readyState === 1) {
				client.send(json);
			}
		} catch {}
	}
}

function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return true; // Direct tools, CLI, curl, internal connections
	try {
		const parsed = new URL(origin);
		if (parsed.protocol === 'tauri:' || parsed.protocol === 'app:') return true;
		if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === 'tauri.localhost') return true;
	} catch {}
	return false;
}

function getCorsHeaders(req: Request): Record<string, string> {
	const origin = req.headers.get('origin');
	return {
		'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin) ? origin : 'http://127.0.0.1',
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Vary': 'Origin'
	};
}

const server = Bun.serve<{ id: string }>({
	port: PORT,
	async fetch(req, server) {
		const url = new URL(req.url);

		// Security: origin check against DNS rebinding / malicious browser origins
		const origin = req.headers.get('origin');
		if (!isAllowedOrigin(origin)) {
			console.warn(`[Security] Blocked request from untrusted origin: ${origin}`);
			return new Response('Forbidden: Untrusted Origin', { status: 403 });
		}

		// CORS Preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, {
				headers: getCorsHeaders(req)
			});
		}

		// Handle WebSocket upgrade
		if (url.pathname === '/ws') {
			const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
			const upgraded = server.upgrade(req, { data: { id: clientId } });
			if (upgraded) return undefined;
			return new Response('WebSocket upgrade failed', { status: 400 });
		}

		// MCP JSON-RPC Endpoint
		if (url.pathname === '/mcp') {
			if (req.method === 'POST') {
				try {
					const body = await req.json();
					const response = await mcpServer.handleJsonRpc(body);
					if (response === null) {
						return new Response(null, {
							status: 204,
							headers: getCorsHeaders(req)
						});
					}
					return new Response(JSON.stringify(response), {
						headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
					});
				} catch (err: any) {
					return new Response(
						JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }),
						{ headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }, status: 400 }
					);
				}
			}
			return new Response(JSON.stringify({ status: 'MCP Endpoint Ready' }), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// Health check
		if (url.pathname === '/health') {
			return new Response(
				JSON.stringify({
					status: 'ok',
					version: '0.1.0',
					bootstrap: publicBootstrap(bootstrap),
					services: redactServiceErrors(supervisor.getStatus()),
					projectsCount: repos.getProjects().length,
					tabsCount: repos.getAllTabs().length,
					uptime: process.uptime()
				}, null, 2),
				{ headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) } }
			);
		}

		// API: Complete Load Settings (Projects, Tabs, Settings, Services, Models)
		if (url.pathname === '/api/settings/load' || url.pathname === '/api/bootstrap') {
			return new Response(
				JSON.stringify({
					projects: repos.getProjects(),
					tabs: repos.getAllTabs(),
					settings: repos.getSettings(),
					services: redactServiceErrors(supervisor.getStatus()),
					models: AVAILABLE_MODELS
				}),
				{ headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) } }
			);
		}

		// API: Tabs
		if (url.pathname === '/api/tabs') {
			return new Response(JSON.stringify(repos.getAllTabs()), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: Tab Messages (GET /api/tabs/:id/messages?days=7)
		if (url.pathname.startsWith('/api/tabs/') && url.pathname.endsWith('/messages') && req.method === 'GET') {
			const parts = url.pathname.split('/');
			const tabId = parts[3];
			const daysParam = url.searchParams.get('days');
			const days = daysParam ? parseInt(daysParam, 10) : 7;
			const messages = repos.getTabMessages(tabId, days);
			return new Response(JSON.stringify(messages), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: Tab Delete (DELETE /api/tabs/:id)
		if (url.pathname.startsWith('/api/tabs/') && req.method === 'DELETE') {
			const parts = url.pathname.split('/');
			const tabId = parts[3];
			if (tabId) {
				deleteProviderSessions(tabId);
				repos.deleteTab(tabId);
			}
			return new Response(JSON.stringify({ success: true, tabId }), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: Projects
		if (url.pathname === '/api/projects') {
			return new Response(JSON.stringify(repos.getProjects()), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: Settings
		if (url.pathname === '/api/settings') {
			return new Response(JSON.stringify(repos.getSettings()), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: Client Log Diagnostics
		if (url.pathname === '/api/log') {
			const err = url.searchParams.get('err');
			const msg = url.searchParams.get('msg');
			console.log(`[CLIENT DIAGNOSTIC LOG] (untrusted) err="${sanitizeDiagnostic(err)}" msg="${sanitizeDiagnostic(msg)}"`);
			return new Response(JSON.stringify({ ok: true }), {
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
			});
		}

		// API: File Upload (Save to sandbox_api/data & forward to DanyAPI /v1/files)
		if (url.pathname === '/api/upload' && req.method === 'POST') {
			try {
				const formData = await req.formData();
				const files: File[] = [];
				const fileEntries = [...formData.getAll('file'), ...formData.getAll('files')];
				for (const entry of fileEntries) {
					if (entry && typeof entry === 'object' && 'name' in entry && 'arrayBuffer' in entry) {
						files.push(entry as File);
					}
				}

				if (files.length === 0) {
					return new Response(JSON.stringify({ error: 'No file provided' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
					});
				}

				const sessionId = (formData.get('session_id') as string) || (formData.get('chatId') as string) || `chat-${Date.now()}`;
				const model = (formData.get('model') as string) || 'default';

				// 1. Save files to sandbox_api/data
				const dataDir = process.env.CONCLAVE_DATA_DIR
					? join(process.env.CONCLAVE_DATA_DIR, 'attachments')
					: join(import.meta.dir, '../../api_sandbox/data');
				if (!existsSync(dataDir)) {
					mkdirSync(dataDir, { recursive: true });
				}

				const results = [];
				for (const file of files) {
					const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
					const savedPath = join(dataDir, sanitizedName);
					const arrayBuffer = await file.arrayBuffer();
					writeFileSync(savedPath, Buffer.from(arrayBuffer));
					console.log(`[Upload] Saved file ${sanitizedName} to ${savedPath}`);

					// 2. Forward to DanyAPI http://127.0.0.1:8000/v1/files
					let danyApiResponse = null;
					let danyError: string | null = null;
					try {
						const danyFormData = new FormData();
						const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' });
						danyFormData.append('file', blob, sanitizedName);
						danyFormData.append('session_id', sessionId);
						const rawModel = (model || '').toLowerCase();
						const effectiveModel = rawModel.includes('qwen') ? rawModel : 'default';
						danyFormData.append('model', effectiveModel);

						let danyRes = await fetch('http://127.0.0.1:8000/v1/files', {
							method: 'POST',
							body: danyFormData
						});

						if (!danyRes.ok && effectiveModel === 'default' && danyRes.status === 404) {
							const fallbackFormData = new FormData();
							fallbackFormData.append('file', blob, sanitizedName);
							fallbackFormData.append('session_id', sessionId);
							danyRes = await fetch('http://127.0.0.1:8000/v1/files', {
								method: 'POST',
								body: fallbackFormData
							});
						}

						if (danyRes.ok) {
							danyApiResponse = await danyRes.json();
							console.log(`[Upload] Forwarded ${sanitizedName} to DanyAPI for session=${sessionId}`);
						} else {
							const errBody = await danyRes.text();
							let cleanDetail = errBody;
							try {
								const parsed = JSON.parse(errBody);
								cleanDetail = parsed.detail || parsed.error?.message || parsed.error || errBody;
							} catch {}
							console.warn(`[Upload] DanyAPI returned ${danyRes.status}: ${cleanDetail}`);
							danyError = cleanDetail;
						}
					} catch (err: any) {
						console.warn(`[Upload] Failed to forward ${sanitizedName} to DanyAPI: ${err.message}`);
						danyError = err.message;
					}

					// 3. Record in SQLite
					try {
						const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
						db.prepare(
							'INSERT OR REPLACE INTO uploads (id, filename, filepath, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
						).run(uploadId, sanitizedName, savedPath, file.type || 'application/octet-stream', file.size, Date.now());
					} catch {}

					results.push({
						filename: sanitizedName,
						filepath: savedPath,
						mimeType: file.type || 'application/octet-stream',
						size: file.size,
						danyApi: danyApiResponse,
						error: danyError
					});
				}

				const failedResult = results.find((r) => r.error);
				if (failedResult) {
					return new Response(JSON.stringify({
						success: false,
						error: failedResult.error || 'DanyAPI upload failed',
						filename: failedResult.filename,
						filepath: failedResult.filepath,
						sessionId,
						files: results
					}), {
						status: 502,
						headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
					});
				}

				return new Response(JSON.stringify({
					success: true,
					filename: results[0].filename,
					filepath: results[0].filepath,
					mimeType: results[0].mimeType,
					size: results[0].size,
					sessionId,
					files: results
				}), {
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
				});
			} catch (err: any) {
				console.error('[Upload Error]', err.message);
				return new Response(JSON.stringify({ error: err.message }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) }
				});
			}
		}

		return new Response('Conclave Orchestrator: Active', {
			headers: getCorsHeaders(req)
		});
	},

	websocket: {
		open(ws) {
			connectedClients.add(ws);
			console.log(`[WebSocket] Client connected (id: ${ws.data.id}, active clients: ${connectedClients.size})`);
			sendWs(ws, {
				type: 'SERVER_READY',
				serverVersion: '0.1.0',
				status: 'ready'
			}, 'server ready handshake');
		},

		async message(ws, raw) {
			try {
				const messageStr = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
				const payload = JSON.parse(messageStr);

				switch (payload.type) {
					case 'LOAD_SETTINGS': {
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [LOAD_SETTINGS] version="${payload.clientVersion || '0.1.0'}"`);
						const projects = repos.getProjects();
						const tabs = repos.getAllTabs();
						const settings = repos.getSettings();
						const services = redactServiceErrors(supervisor.getStatus());
						const plugins = await pluginManager.list();
						sendWs(ws, {
							type: 'SETTINGS_LOADED',
							projects,
							tabs,
							settings,
							services,
							models: AVAILABLE_MODELS,
							plugins
						}, `${projects.length} projects, ${tabs.length} tabs, ${AVAILABLE_MODELS.length} models, ${plugins.length} plugins`);
						break;
					}

					case 'TAB_FETCH': {
						const id = payload.tabId;
						const days = typeof payload.days === 'number' ? payload.days : 7;
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [TAB_FETCH] tabId="${id}", days=${days}`);
						const messages = repos.getTabMessages(id, days);
						sendWs(ws, {
							type: 'TAB_DETAIL',
							tabId: id,
							messages
						}, `${messages.length} messages for tab "${id}"`);
						break;
					}

					case 'TAB_CREATE': {
						const defaultProj = repos.getProjects()[0];
						const projectId = payload.projectId || defaultProj?.id;
						const name = payload.name || 'New Conversation';
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [TAB_CREATE] project="${projectId}", name="${name}"`);
						const tab = repos.createTab(projectId, name);
						broadcastWs({
							type: 'TAB_CREATED',
							tab
						}, `tabId="${tab.id}", name="${tab.name}" in project="${projectId}"`);
						break;
					}

					case 'TAB_RENAME': {
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [TAB_RENAME] tabId="${payload.tabId}", newName="${payload.name}"`);
						repos.renameTab(payload.tabId, payload.name);
						broadcastWs({
							type: 'TAB_RENAMED',
							tabId: payload.tabId,
							name: payload.name
						}, `tabId="${payload.tabId}"`);
						break;
					}

					case 'TAB_DELETE': {
						const id = payload.tabId;
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [TAB_DELETE] tabId="${id}"`);
						if (id) {
							deleteProviderSessions(id);
							repos.deleteTab(id);
						}
						broadcastWs({
							type: 'TAB_DELETED',
							tabId: id
						}, `tabId="${id}"`);
						break;
					}

					case 'TAB_ARCHIVE': {
						const id = payload.tabId;
						const archived = payload.archived !== false;
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [TAB_ARCHIVE] tabId="${id}", archived=${archived}`);
						if (id) {
							repos.setTabArchived(id, archived);
							broadcastWs({
								type: 'TAB_ARCHIVED',
								tabId: id,
								archived
							}, `tabId="${id}", archived=${archived}`);
						}
						break;
					}

					case 'PROJECT_CREATE': {
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [PROJECT_CREATE] name="${payload.name}"`);
						const project = repos.createProject(
							payload.name,
							payload.directoryPath,
							payload.skills,
							payload.metadata,
							payload.icon
						);
						broadcastWs({
							type: 'PROJECT_CREATED',
							project
						}, `projectId="${project.id}", name="${project.name}"`);
						break;
					}

					case 'PROMPT_SEND': {
						const { tabId, content, attachments, provider, model } = payload;
						const promptSnippet = (content || '').slice(0, 45).replace(/\n/g, ' ');
						const attachInfo = attachments?.length ? ` (${attachments.length} attachments)` : '';
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [PROMPT_SEND] tabId="${tabId}", provider="${provider || 'default'}", model="${model || 'default'}", prompt="${promptSnippet}..."${attachInfo}`);

						let tokenCount = 0;
						let totalTokensReported = 0;

						// Stream response from LLM router
						for await (const event of llmRouter.streamChat({
							tabId,
							message: content,
							attachments,
							provider,
							model
						})) {
							if (event.type === 'token') {
								tokenCount++;
								ws.send(
									JSON.stringify({
										type: 'CHAT_TOKEN',
										tabId,
										token: event.data.token
									})
								);
							} else if (event.type === 'tool_step') {
								sendWs(ws, {
									type: 'TOOL_STEP_UPDATE',
									tabId,
									step: event.data
								}, `step="${event.data?.title || 'step'}"`);
							} else if (event.type === 'usage') {
								totalTokensReported = event.data.totalTokens;
								const effectiveModel = event.data.model || model;
								sendWs(ws, {
									type: 'CHAT_USAGE',
									tabId,
									totalTokens: event.data.totalTokens,
									model: effectiveModel
								}, `model="${effectiveModel}", totalTokens=${event.data.totalTokens}`);
							} else if (event.type === 'error') {
								sendWs(ws, {
									type: 'CHAT_ERROR',
									tabId,
									error: event.data.error
								}, `error="${event.data.error}"`);
							} else if (event.type === 'complete') {
								const effectiveModel = event.data.model || model;
								const count = event.data.totalTokens || totalTokensReported;
								sendWs(ws, {
									type: 'CHAT_COMPLETE',
									tabId,
									messageId: event.data.messageId,
									totalTokens: count,
									model: effectiveModel
								}, `messageId="${event.data.messageId}", streamed ${tokenCount} chunks, model="${effectiveModel}", tokens used: ${count}`);

								// Broadcast to other windows that tab has updated messages
								broadcastWs({
									type: 'TAB_UPDATED',
									tabId,
									lastMessageId: event.data.messageId
								}, `tabId="${tabId}" updated`);
							}
						}
						break;
					}

					case 'MCP_REQUEST': {
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [MCP_REQUEST] method="${payload.rpc?.method}"`);
						const rpcRes = await mcpServer.handleJsonRpc(payload.rpc);
						sendWs(ws, {
							type: 'MCP_RESPONSE',
							rpc: rpcRes
						}, `method="${payload.rpc?.method}"`);
						break;
					}

					case 'PLUGIN_LIST': {
						const plugins = await pluginManager.list();
						broadcastWs({ type: 'PLUGINS_UPDATED', plugins });
						break;
					}

					case 'PLUGIN_INSTALL': {
						// Either { url } (git repo with plugin.json) or { manifest } (inline).
						try {
							if (payload.url) {
								const manifest = await pluginManager.installFromGit(payload.url);
								console.log(`[WebSocket] Installed plugin '${manifest.id}' from ${payload.url}`);
							} else if (payload.manifest) {
								await pluginManager.register(payload.manifest);
							} else {
								throw new Error('PLUGIN_INSTALL requires "url" or "manifest"');
							}
						} catch (err: any) {
							broadcastWs({ type: 'PLUGIN_ERROR', error: String(err.message || err), source: 'install' });
						}
						broadcastWs({ type: 'PLUGINS_UPDATED', plugins: await pluginManager.list() });
						break;
					}

					case 'PLUGIN_REMOVE': {
						try {
							await pluginManager.remove(payload.id);
						} catch (err: any) {
							broadcastWs({ type: 'PLUGIN_ERROR', error: String(err.message || err), source: 'remove' });
						}
						broadcastWs({ type: 'PLUGINS_UPDATED', plugins: await pluginManager.list() });
						break;
					}

					case 'PLUGIN_TOGGLE': {
						try {
							await pluginManager.toggle(payload.id, !!payload.enabled);
						} catch (err: any) {
							broadcastWs({ type: 'PLUGIN_ERROR', error: String(err.message || err), source: 'toggle' });
						}
						broadcastWs({ type: 'PLUGINS_UPDATED', plugins: await pluginManager.list() });
						break;
					}

					case 'SETTINGS_SET': {
						console.log(`[WebSocket] Incoming <- ${ws.data.id} [SETTINGS_SET] key="${payload.key}", value="${payload.value}"`);
						repos.setSetting(payload.key, String(payload.value));
						sendWs(ws, {
							type: 'SETTINGS_UPDATED',
							settings: repos.getSettings()
						}, `updated key="${payload.key}"`);
						break;
					}

					default:
						console.warn(`[WebSocket] Incoming <- ${ws.data.id} [UNKNOWN: ${payload.type}]`);
						sendWs(ws, { type: 'ERROR', message: `Unknown event type: ${payload.type}` }, 'unknown event error');
				}
			} catch (err: any) {
				console.error(`[WebSocket Error] ${err.message}`);
				ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
			}
		},

		close(ws) {
			connectedClients.delete(ws);
			console.log(`[WebSocket] Client disconnected (id: ${ws.data.id}, remaining clients: ${connectedClients.size})`);
		}
	}
});

function sendWs(ws: any, payload: any, detail?: string): number {
	const json = JSON.stringify(payload);
	const bytes = Buffer.byteLength(json, 'utf-8');
	const sizeStr = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
	const desc = detail ? ` (${sizeStr}: ${detail})` : ` (${sizeStr})`;
	console.log(`[WebSocket] Outgoing -> ${ws.data.id} [${payload.type}]${desc}`);
	ws.send(json);
	return bytes;
}

console.log(`\n[Orchestrator] Server listening on http://127.0.0.1:${server.port}`);
console.log(`   - WebSocket Endpoint: ws://127.0.0.1:${server.port}/ws`);
console.log(`   - MCP JSON-RPC:       http://127.0.0.1:${server.port}/mcp`);
console.log(`   - Health Check:       http://127.0.0.1:${server.port}/health\n`);

// Handle graceful shutdown
process.on('SIGINT', () => {
	console.log('\nShutting down orchestrator...');
	supervisor.stopAll();
	server.stop();
	process.exit(0);
});

process.on('SIGTERM', () => {
	supervisor.stopAll();
	server.stop();
	process.exit(0);
});
