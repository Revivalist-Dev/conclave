import { harness } from '../stores/harness.svelte';
import { isTauriEnvironment, tauriInvoke, listenTauriEvent } from './windowManager';

export type SocketStatus = 'connected' | 'connecting' | 'disconnected';

/**
 * JS-side orchestrator logic. The WebSocket transport itself lives in the Tauri
 * process (src-tauri/src/orchestrator_ws.rs): server traffic arrives via the
 * `orchestrator-message` event, outbound payloads go through the `ws_send`
 * invoke (Rust queues and flushes them while offline), and connection state
 * changes arrive via `orchestrator-status`. Reconnects with backoff are
 * handled natively; this module only decides what the messages mean.
 */
class OrchestratorSocketClient {
	status = $state<SocketStatus>('disconnected');
	services = $state<any[]>([]);
	url = 'ws://127.0.0.1:4000/ws';

	private started = false;
	private pendingResolvers: Map<string | number, (res: any) => void> = new Map();
	private rpcIdCounter = 1;
	private lastSettingsRequestTime = 0;

	constructor() {
		if (typeof window !== 'undefined') {
			(window as any).__orchestratorSocket = this;
			this.connect();
		}
	}

	public connect() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;

		if (!isTauriEnvironment()) {
			console.info('[OrchestratorBridge] Not running inside Tauri; orchestrator bridge unavailable.');
			return;
		}

		this.status = 'connecting';

		listenTauriEvent('orchestrator-message', (payload: any) => {
			this.handleMessage(payload);
		});

		listenTauriEvent('orchestrator-status', (payload: any) => {
			// Rust serializes the status enum as a bare JSON string ("connected");
			// tolerate a {"status": ...} wrapper too.
			const next = typeof payload === 'string' ? payload : payload?.status;
			if (next === 'connected' || next === 'connecting' || next === 'disconnected') {
				const wasConnected = this.status === 'connected';
				this.status = next;
				// Handshake/refresh is JS logic: run it on every (re)connection.
				if (next === 'connected' && !wasConnected) this.onConnected();
			}
		});

		// Sync with whatever state the Rust supervisor is already in. A window that
		// loads after the connection was established missed the SERVER_READY
		// broadcast, so it requests settings directly (queued natively if offline).
		tauriInvoke<SocketStatus>('ws_status')
			.then((initial) => {
				if (initial === 'connected' || initial === 'connecting' || initial === 'disconnected') {
					const wasConnected = this.status === 'connected';
					this.status = initial;
					if (initial === 'connected' && !wasConnected) this.onConnected();
				}
			})
			.catch(() => {});
	}

	/**
	 * Handshake + state refresh, driven from JS on connection or SERVER_READY.
	 * Coalesced across windows and triggers so exactly one LOAD_SETTINGS is sent.
	 */
	public requestSettings(force = false) {
		// The overlay HUD does not need to initiate handshakes; main desktop window drives it.
		if (typeof window !== 'undefined' && window.location.pathname.startsWith('/overlay') && !force) {
			return;
		}

		const now = Date.now();
		// Also coordinate across windows via localStorage timestamp
		const lastAcrossWindows = typeof localStorage !== 'undefined'
			? parseInt(localStorage.getItem('conclave_last_load_settings') || '0', 10)
			: 0;

		if (!force && (now - this.lastSettingsRequestTime < 2000 || now - lastAcrossWindows < 2000)) {
			return;
		}

		this.lastSettingsRequestTime = now;
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem('conclave_last_load_settings', String(now));
			} catch {}
		}

		this.send({ type: 'LOAD_SETTINGS', clientVersion: '0.1.0' });
	}

	private onConnected() {
		this.requestSettings();
	}

	/** Ask the Rust supervisor to skip its backoff and reconnect immediately. */
	public manualReconnect() {
		if (!isTauriEnvironment()) return;
		tauriInvoke('ws_reconnect').catch(() => {});
	}

	/**
	 * Send a payload to the orchestrator. Fire-and-forget: when the socket is
	 * down the payload is queued natively and flushed after reconnecting.
	 * Returns whether the socket was connected at call time.
	 */
	public send(payload: any): boolean {
		if (typeof window === 'undefined') return false;
		tauriInvoke('ws_send', { payload }).catch((err) => {
			console.warn('[OrchestratorBridge] ws_send failed:', err);
		});
		return this.status === 'connected';
	}

	/** JSON-RPC request over the orchestrator connection (MCP tooling). */
	public async callMcp(method: string, params?: any): Promise<any> {
		const id = this.rpcIdCounter++;
		const rpc = { jsonrpc: '2.0', id, method, params };

		return new Promise((resolve) => {
			this.pendingResolvers.set(id, resolve);
			const sent = this.send({ type: 'MCP_REQUEST', rpc });
			if (!sent) {
				this.pendingResolvers.delete(id);
				resolve({ jsonrpc: '2.0', id, error: { code: -32000, message: 'WebSocket not connected' } });
			}
		});
	}

	private handleMessage(data: any) {
		try {
			switch (data.type) {
				case 'SERVER_READY': {
					// 1. Server announced readiness; client acknowledges by requesting environment settings
					this.requestSettings();
					break;
				}

				case 'SETTINGS_LOADED': {
					// 2. Server returned complete environment (projects, tabs, models, settings, plugins)
					if (data.services) {
						this.services = data.services;
					}
					if (data.plugins) {
						harness.plugins = data.plugins;
						harness.syncPluginModels(data.plugins);
					}
					harness.initFromSettings(data);
					break;
				}

				case 'TAB_CREATED': {
					harness.handleTabCreated(data.tab);
					break;
				}

				case 'TAB_DETAIL': {
					harness.handleTabDetail(data.tabId, data.messages);
					break;
				}

				case 'TAB_RENAMED': {
					harness.updateConversationTitle(data.tabId, data.name);
					break;
				}

				case 'TAB_DELETED': {
					harness.handleTabDeleted(data.tabId);
					break;
				}

				case 'TAB_UPDATED': {
					// Refetch regardless of which tab is active: this keeps hidden
					// windows populated (e.g. the fullscreen chat while in HUD mode,
					// including responses for tabs that were never opened there).
					if (data.tabId) {
						harness.fetchTabMessages(data.tabId, 7, true);
					}
					break;
				}

				case 'TAB_ARCHIVED': {
					harness.handleTabArchived(data.tabId, !!data.archived);
					break;
				}

				case 'PLUGINS_UPDATED': {
					harness.plugins = data.plugins || [];
					harness.pluginError = '';
					harness.syncPluginModels(harness.plugins);
					break;
				}

				case 'PLUGIN_ERROR': {
					harness.pluginError = data.error || 'Unknown plugin error';
					break;
				}

				case 'CHAT_TOKEN': {
					const conv = harness.conversations.find((c) => c.id === data.tabId || c.chatId === data.tabId);
					if (conv && conv.messages.length > 0) {
						const lastMsg = conv.messages[conv.messages.length - 1];
						if (lastMsg.role === 'assistant') {
							lastMsg.content += data.token;
						}
					}
					break;
				}

				case 'TOOL_STEP_UPDATE': {
					const conv = harness.conversations.find((c) => c.id === data.tabId || c.chatId === data.tabId);
					if (conv && conv.messages.length > 0) {
						const lastMsg = conv.messages[conv.messages.length - 1];
						if (lastMsg.role === 'assistant') {
							if (!lastMsg.toolSteps) lastMsg.toolSteps = [];
							const existing = lastMsg.toolSteps.find((s) => s.name === data.step.title);
							if (existing) {
								existing.status = data.step.status === 'done' ? 'completed' : 'running';
								if (data.step.details) {
									existing.details = data.step.details.map((d: any) => ({
										title: d.action,
										content: d.detail || '',
										status: d.status === 'done' ? 'success' : 'info'
									}));
								}
							} else {
								lastMsg.toolSteps.push({
									id: `step-${Date.now()}`,
									name: data.step.title,
									count: data.step.badgeCount || 1,
									status: data.step.status === 'done' ? 'completed' : 'running',
									details: (data.step.details || []).map((d: any) => ({
										title: d.action,
										content: d.detail || '',
										status: d.status === 'done' ? 'success' : 'info'
									}))
								});
							}
						}
					}
					break;
				}

				case 'CHAT_USAGE': {
					if (typeof data.totalTokens === 'number') {
						const conv = harness.conversations.find((c) => c.id === data.tabId || c.chatId === data.tabId);
						if (conv && conv.messages.length > 0) {
							const lastMsg = conv.messages[conv.messages.length - 1];
							if (lastMsg.role === 'assistant') {
								lastMsg.totalTokens = data.totalTokens;
								if (data.model) lastMsg.model = data.model;
							}
						}
					}
					break;
				}

				case 'CHAT_ERROR': {
					harness.isGenerating = false;
					const conv = harness.conversations.find((c) => c.id === data.tabId || c.chatId === data.tabId);
					if (conv && conv.messages.length > 0) {
						const lastMsg = conv.messages[conv.messages.length - 1];
						if (lastMsg.role === 'assistant') {
							if (!lastMsg.content || !lastMsg.content.includes(data.error)) {
								const errNotice = `**Error**: ${data.error}`;
								lastMsg.content = lastMsg.content ? `${lastMsg.content}\n\n> ${errNotice}` : `> ${errNotice}`;
							}
						}
					}
					break;
				}

				case 'CHAT_COMPLETE': {
					harness.isGenerating = false;
					const conv = harness.conversations.find((c) => c.id === data.tabId || c.chatId === data.tabId);
					if (conv && conv.messages.length > 0) {
						const lastMsg = conv.messages[conv.messages.length - 1];
						if (lastMsg.role === 'assistant') {
							if (typeof data.totalTokens === 'number') {
								lastMsg.totalTokens = data.totalTokens;
							}
							if (data.model) {
								lastMsg.model = data.model;
							}
						}
					}
					break;
				}

				case 'MCP_RESPONSE': {
					const rpc = data.rpc;
					if (rpc && rpc.id && this.pendingResolvers.has(rpc.id)) {
						const resolver = this.pendingResolvers.get(rpc.id);
						this.pendingResolvers.delete(rpc.id);
						resolver?.(rpc);
					}
					break;
				}
			}
		} catch (err: any) {
			console.error('Error handling orchestrator message:', err?.message);
		}
	}
}

export const orchestratorSocket = new OrchestratorSocketClient();
