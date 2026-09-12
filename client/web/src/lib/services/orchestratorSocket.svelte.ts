import { harness } from '../stores/harness.svelte';

export type SocketStatus = 'connected' | 'connecting' | 'disconnected';

class OrchestratorSocketClient {
	status = $state<SocketStatus>('disconnected');
	services = $state<any[]>([]);
	url = $state<string>('ws://127.0.0.1:4000/ws');

	private socket: WebSocket | null = null;
	private reconnectTimer: any = null;
	private pendingResolvers: Map<string | number, (res: any) => void> = new Map();
	private rpcIdCounter = 1;

	constructor() {
		// Only run in browser environment
		if (typeof window !== 'undefined') {
			(window as any).__orchestratorSocket = this;
			this.connect();
		}
	}

	public connect() {
		if (typeof window === 'undefined') return;
		if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
			return;
		}

		this.status = 'connecting';
		try {
			this.socket = new WebSocket(this.url);

			this.socket.onopen = () => {
				this.status = 'connected';
				console.log('[WebSocket] Connected to brAInstorm Orchestrator');
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer);
					this.reconnectTimer = null;
				}
			};

			this.socket.onmessage = (event) => {
				this.handleMessage(event.data);
			};

			this.socket.onclose = () => {
				this.status = 'disconnected';
				this.scheduleReconnect();
			};

			this.socket.onerror = () => {
				// Browser already logs connection refusal; gracefully close to trigger reconnect
				try {
					this.socket?.close();
				} catch {}
			};
		} catch (err) {
			this.status = 'disconnected';
			this.scheduleReconnect();
		}
	}

	public manualReconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.socket) {
			try {
				this.socket.close();
			} catch {}
			this.socket = null;
		}
		this.connect();
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, 3000);
	}

	public send(payload: any) {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify(payload));
			return true;
		}
		return false;
	}

	private handleMessage(raw: string) {
		try {
			const data = JSON.parse(raw);

			switch (data.type) {
				case 'SERVER_READY': {
					// 1. Server announced readiness; client acknowledges by requesting environment settings
					this.send({ type: 'LOAD_SETTINGS', clientVersion: '0.1.0' });
					break;
				}

				case 'SETTINGS_LOADED': {
					// 2. Server returned complete environment (projects, tabs, models, settings)
					if (data.services) {
						this.services = data.services;
					}
					harness.initFromSettings(data);
					break;
				}

				case 'TAB_CREATED':
				case 'CONVERSATION_CREATED': {
					harness.handleTabCreated(data.tab || data.conversation);
					break;
				}

				case 'TAB_DETAIL':
				case 'CONVERSATION_DETAIL': {
					harness.handleTabDetail(data.tabId || data.conversationId, data.messages);
					break;
				}

				case 'TAB_RENAMED': {
					harness.updateConversationTitle(data.tabId, data.name);
					break;
				}

				case 'TAB_DELETED':
				case 'CONVERSATION_DELETED': {
					harness.handleTabDeleted(data.tabId || data.conversationId);
					break;
				}

				case 'CHAT_TOKEN': {
					const targetId = data.tabId || data.conversationId;
					const conv = harness.conversations.find((c) => c.id === targetId || c.chatId === targetId);
					if (conv && conv.messages.length > 0) {
						const lastMsg = conv.messages[conv.messages.length - 1];
						if (lastMsg.role === 'assistant') {
							lastMsg.content += data.token;
						}
					}
					break;
				}

				case 'TOOL_STEP_UPDATE': {
					const targetId = data.tabId || data.conversationId;
					const conv = harness.conversations.find((c) => c.id === targetId || c.chatId === targetId);
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
						const targetId = data.tabId || data.conversationId;
						const conv = harness.conversations.find((c) => c.id === targetId || c.chatId === targetId);
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
					const targetId = data.tabId || data.conversationId;
					const conv = harness.conversations.find((c) => c.id === targetId || c.chatId === targetId);
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
					const targetId = data.tabId || data.conversationId;
					const conv = harness.conversations.find((c) => c.id === targetId || c.chatId === targetId);
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
			console.error('Error handling WebSocket message:', err.message);
		}
	}

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
}

export const orchestratorSocket = new OrchestratorSocketClient();
