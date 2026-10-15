import type { Conversation, Message, Provider, HarnessSettings, ToolStep, Attachment, Project, Tab, ModelInfo } from '../types';
import { enterMinimalistWindow, exitMinimalistWindow, loadWindowState, initWindowListeners, setAlwaysOnTop, isTauriEnvironment } from '../services/windowManager';
import { goto } from '$app/navigation';

const INITIAL_PROVIDERS: Provider[] = [
	{
		id: 'deepseek',
		name: 'DeepSeek (DanyAPI)',
		type: 'deepseek',
		endpoint: 'http://localhost:8000/v1',
		models: [
			'deepseek-v4-flash',
			'deepseek-v4-flash-thinking',
			'deepseek-v4-pro',
			'deepseek-v4-pro-thinking',
			'deepseek-v4-vision',
			'qwen3.7-plus',
			'qwen3.8-max'
		],
		activeModel: 'deepseek-v4-flash',
		status: 'online',
		latency: 18,
		isLocal: true
	},
	{
		id: 'claude',
		name: 'Claude',
		type: 'claude',
		endpoint: 'https://api.anthropic.com/v1',
		models: ['Claude Opus 5 High', 'Claude 3.7 Sonnet', 'Claude 3.5 Haiku'],
		activeModel: 'Claude Opus 5 High',
		status: 'online',
		latency: 42,
		isLocal: false
	},
	{
		id: 'ollama',
		name: 'Ollama',
		type: 'ollama',
		endpoint: 'http://localhost:11434',
		models: ['Llama 3.3 70B', 'DeepSeek R1 14B', 'Qwen 2.5 Coder 32B', 'Gemma 2 9B'],
		activeModel: 'Llama 3.3 70B',
		status: 'online',
		latency: 12,
		isLocal: true
	},
	{
		id: 'lmstudio',
		name: 'LM Studio',
		type: 'lmstudio',
		endpoint: 'http://localhost:1234/v1',
		models: ['Qwen 2.5 Coder 32B', 'DeepSeek Coder V2', 'Phi 4 Mini'],
		activeModel: 'Qwen 2.5 Coder 32B',
		status: 'online',
		latency: 8,
		isLocal: true
	},
	{
		id: 'vllm',
		name: 'vLLM Local',
		type: 'vllm',
		endpoint: 'http://localhost:8000/v1',
		models: ['Mistral Large 2', 'Llama 3.1 8B Instruct'],
		activeModel: 'Mistral Large 2',
		status: 'offline',
		isLocal: true
	},
	{
		id: 'custom',
		name: 'Bun Local Router',
		type: 'custom',
		endpoint: 'http://localhost:3000/api/chat',
		models: ['Local Fast Router', 'Custom Engine'],
		activeModel: 'Local Fast Router',
		status: 'online',
		latency: 3,
		isLocal: true
	}
];

class HarnessStore {
	// Svelte 5 runes state
	conversations = $state<Conversation[]>([]);
	serverProjects = $state<Project[]>([]);
	providers = $state<Provider[]>(INITIAL_PROVIDERS);
	// Installed plugins (MCP servers / process plugins) — refreshed via PLUGINS_UPDATED
	plugins = $state<any[]>([]);
	pluginError = $state<string>('');
	availableModels = $state<ModelInfo[]>([
		{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'DeepSeek', desc: 'Fast reasoning & chat' },
		{ id: 'deepseek-v4-flash-thinking', name: 'DeepSeek V4 Flash (Thinking)', provider: 'DeepSeek', desc: 'Deep thinking reasoning process' },
		{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek', desc: 'High capability deep model' },
		{ id: 'deepseek-v4-pro-thinking', name: 'DeepSeek V4 Pro (Thinking)', provider: 'DeepSeek', desc: 'Maximum reasoning & reflection' },
		{ id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', provider: 'Qwen', desc: 'Multimodal & vision analysis' },
		{ id: 'qwen3.8-max', name: 'Qwen 3.8 Max', provider: 'Qwen', desc: 'Frontier multimodal coder' },
		{ id: 'Claude Opus 5 High', name: 'Claude Opus 5 High', provider: 'Claude', desc: 'Anthropic frontier model' },
		{ id: 'Claude 3.7 Sonnet', name: 'Claude 3.7 Sonnet', provider: 'Claude', desc: 'Hybrid reasoning model' }
	]);
	providerFilter = $state<string>('all'); // 'all' | provider.id
	searchQuery = $state<string>('');
	activeConversationId = $state<string>('');
	openTabIds = $state<string[]>([]);
	sidebarOpen = $state<boolean>(true);
	projectsExpanded = $state<boolean>(true);
	projects = $state<string[]>(['Discussions']);
	showNewChatModal = $state<boolean>(false);
	pendingNewChatGroup = $state<string>('Discussions');
	lastProjectDirectory = $state<string>(typeof localStorage !== 'undefined' ? localStorage.getItem('conclave_last_project_dir') || '' : '');
	selectedLlmProvider = $state<string>('DeepSeek');
	private inFlightFetches = new Set<string>();
	private lastTabFetchTime = new Map<string, number>();
	// Active model persists across sessions; both windows (desktop + HUD) share
	// this store and its setActiveModel/applyTabLastModel functions.
	selectedLlmModel = $state<string>(
		typeof localStorage !== 'undefined'
			? localStorage.getItem('conclave_active_model') || 'deepseek-v4-flash'
			: 'deepseek-v4-flash'
	);
	isGenerating = $state<boolean>(false);
	isMinimalistMode = $state<boolean>(false);
	messageSortOrder = $state<'asc' | 'desc'>('asc'); // 'asc' = oldest first, 'desc' = newest first

	settings = $state<HarnessSettings>({
		temperature: 0.7,
		maxTokens: 4096,
		topP: 0.95,
		systemPrompt: 'You are a precise, efficient AI software engineer and assistant.',
		stream: true,
		routerEndpoint: '/api/chat',
		overlayResponseDuration:
			typeof localStorage !== 'undefined' && localStorage.getItem('conclave_overlay_duration')
				? Number(localStorage.getItem('conclave_overlay_duration')) || 15
				: 15
	});

	// Derived state
	filteredConversations = $derived.by(() => {
		return this.conversations.filter((conv) => {
			const matchesFilter =
				this.providerFilter === 'all' || conv.providerId === this.providerFilter;
			const matchesSearch =
				!this.searchQuery.trim() ||
				conv.title.toLowerCase().includes(this.searchQuery.toLowerCase());
			return matchesFilter && matchesSearch;
		});
	});

	groupedConversations = $derived.by(() => {
		const groups: { [group: string]: Conversation[] } = {};
		const groupNames = this.serverProjects.length > 0
			? this.serverProjects.map((p) => p.name)
			: this.projects.length > 0
				? this.projects
				: ['Discussions'];

		for (const p of groupNames) {
			groups[p] = [];
		}
		for (const conv of this.filteredConversations) {
			if (conv.archived) continue;
			const grp = conv.group || 'Discussions';
			if (!groups[grp]) {
				groups[grp] = [];
			}
			groups[grp].push(conv);
		}
		return groups;
	});

	activeConversation = $derived.by(() => {
		if (this.conversations.length === 0) return null;
		return (
			this.conversations.find((c) => c.id === this.activeConversationId) ||
			this.conversations[0]
		);
	});

	// Messages ordered newest-to-oldest if messageSortOrder === 'desc'
	displayedMessages = $derived.by(() => {
		const msgs = this.activeConversation?.messages || [];
		if (this.messageSortOrder === 'desc') {
			return [...msgs].sort((a, b) => b.createdAt - a.createdAt);
		}
		return [...msgs].sort((a, b) => a.createdAt - b.createdAt);
	});

	activeProvider = $derived.by(() => {
		const conv = this.activeConversation;
		if (!conv) return this.providers[0];
		return this.providers.find((p) => p.id === conv.providerId) || this.providers[0];
	});

	openTabs = $derived.by(() => {
		return this.openTabIds
			.map((id) => this.conversations.find((c) => c.id === id))
			.filter((c): c is Conversation => Boolean(c));
	});

	// Actions
	/** Provider that owns a model id (falls back to sensible defaults). */
	resolveProvider(model: string): string {
		if (!model) return 'DeepSeek';
		const known = this.availableModels.find((m) => m.id === model || m.name === model);
		if (known) return known.provider;
		if (/^claude/i.test(model)) return 'Claude';
		return 'DeepSeek';
	}

	/**
	 * Change the active model: it becomes the model used for subsequent prompts,
	 * is recorded on the active conversation, and persists across sessions.
	 */
	setActiveModel(model: string) {
		if (!model) return;
		this.selectedLlmModel = model;
		this.selectedLlmProvider = this.resolveProvider(model);
		const conv = this.activeConversation;
		if (conv) {
			conv.model = model;
			conv.providerId = this.selectedLlmProvider;
		}
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('conclave_active_model', model);
		}
	}

	/** Adopt a conversation's last-used model as the active one (tab continuation). */
	applyTabLastModel(tab?: { model?: string } | null) {
		const candidate = tab?.model;
		if (candidate && candidate !== this.selectedLlmModel) {
			this.selectedLlmModel = candidate;
			this.selectedLlmProvider = this.resolveProvider(candidate);
		}
	}

	toggleMessageSortOrder() {
		this.messageSortOrder = this.messageSortOrder === 'asc' ? 'desc' : 'asc';
	}

	setProviderFilter(filterId: string) {
		this.providerFilter = filterId;
	}

	toggleSidebar() {
		this.sidebarOpen = !this.sidebarOpen;
	}

	toggleProjects() {
		this.projectsExpanded = !this.projectsExpanded;
	}

	addProject(name: string) {
		const trimmed = name.trim();
		if (!trimmed) return;
		if (!this.projects.includes(trimmed)) {
			this.projects.push(trimmed);
		}
		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			(window as any).__orchestratorSocket.send({
				type: 'PROJECT_CREATE',
				name: trimmed
			});
		}
	}

	selectConversation(id: string) {
		if (!id) return;
		this.activeConversationId = id;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('conclave_active_tab', id);
		}
		if (!this.openTabIds.includes(id)) {
			this.openTabIds.push(id);
		}
		const conv = this.conversations.find((c) => c.id === id);
		if (conv) {
			// Continuing a conversation means continuing with its last-used model
			this.applyTabLastModel(conv);
		}
		if (!conv || conv.messages.length === 0) {
			this.fetchTabMessages(id);
		}
	}

	closeTab(id: string, event?: MouseEvent) {
		if (event) event.stopPropagation();
		this.openTabIds = this.openTabIds.filter((tabId) => tabId !== id);
		if (this.activeConversationId === id) {
			if (this.openTabIds.length > 0) {
				this.activeConversationId = this.openTabIds[this.openTabIds.length - 1];
			} else if (this.conversations.length > 0) {
				this.activeConversationId = this.conversations[0].id;
				this.openTabIds = [this.conversations[0].id];
			} else {
				this.activeConversationId = '';
			}
		}
	}

	openNewChatModal(group = 'Discussions') {
		this.pendingNewChatGroup = group;
		this.showNewChatModal = true;
	}

	async initWindowState() {
		initWindowListeners();
		try {
			const state = await loadWindowState();
			this.isMinimalistMode = state.mode === 'minimalist';
		} catch (e) {
			console.warn('[Harness] Could not load window state:', e);
		}
	}

	async enterMinimalistMode() {
		this.isMinimalistMode = true;
		if (this.activeConversationId && typeof localStorage !== 'undefined') {
			localStorage.setItem('conclave_active_tab', this.activeConversationId);
		}
		await enterMinimalistWindow();
	}

	async exitMinimalistMode() {
		this.isMinimalistMode = false;
		await exitMinimalistWindow(this.activeConversationId || undefined);
	}

	async toggleMinimalistMode() {
		if (this.isMinimalistMode) {
			await this.exitMinimalistMode();
		} else {
			await this.enterMinimalistMode();
		}
	}

	async fetchTabMessages(tabId: string, days = 7, force = false) {
		if (!tabId) return;

		// The overlay HUD does not render conversation threads; skip background message hydration
		if (typeof window !== 'undefined' && window.location.pathname.startsWith('/overlay') && !force) {
			return;
		}

		const now = Date.now();
		const lastTime = this.lastTabFetchTime.get(tabId) || 0;
		if (!force && this.inFlightFetches.has(tabId)) {
			return;
		}
		if (!force && now - lastTime < 1500) {
			return;
		}

		this.inFlightFetches.add(tabId);
		this.lastTabFetchTime.set(tabId, now);

		try {
			// 1. If WebSocket is connected, send TAB_FETCH as the primary transport
			if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
				(window as any).__orchestratorSocket.send({ type: 'TAB_FETCH', tabId, days });
			} else {
				// 2. Direct HTTP API fallback when disconnected
				const res = await fetch(`http://127.0.0.1:4000/api/tabs/${tabId}/messages?days=${days}`);
				if (res.ok) {
					const messages = await res.json();
					this.handleTabDetail(tabId, messages);
				}
			}
		} catch (err) {
			console.warn('[Harness] fetchTabMessages failed:', err);
		} finally {
			setTimeout(() => {
				this.inFlightFetches.delete(tabId);
			}, 300);
		}
	}

	/**
	 * Derive the available-models list from installed plugins (each plugin's
	 * manifest declares the models it provides). Falls back to the built-in
	 * list when no plugin declares models (e.g. orchestrator offline in dev).
	 */
	syncPluginModels(plugins: any[]) {
		const derived: ModelInfo[] = [];
		for (const p of plugins || []) {
			for (const m of p.models || []) {
				derived.push({ id: m.id, name: m.name || m.id, provider: p.name || p.id, desc: `plugin: ${p.id}` });
			}
		}
		if (derived.length > 0) this.availableModels = derived;
	}

	initFromSettings(data: any) {
		if (data.models && Array.isArray(data.models)) {
			this.availableModels = data.models;
		}
		if (data.settings && typeof data.settings === 'object') {
			this.settings = { ...this.settings, ...data.settings };
			if (data.settings.temperature !== undefined) {
				const t = parseFloat(data.settings.temperature);
				if (!isNaN(t)) this.settings.temperature = t;
			}
			if (data.settings.max_tokens !== undefined) {
				const m = parseInt(data.settings.max_tokens, 10);
				if (!isNaN(m)) this.settings.maxTokens = m;
			}
			if (data.settings.overlay_response_duration) {
				const d = Number(data.settings.overlay_response_duration);
				if (!isNaN(d) && d > 0) this.settings.overlayResponseDuration = d;
			}
		}
		this.initFromServer(data.projects || [], data.tabs || []);
	}

	setSetting(key: string, value: any) {
		if (typeof window !== 'undefined') {
			(window as any).__orchestratorSocket?.send({
				type: 'SETTINGS_SET',
				key,
				value: String(value)
			});
		}
	}

	setOverlayResponseDuration(seconds: number) {
		this.settings.overlayResponseDuration = seconds;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('conclave_overlay_duration', String(seconds));
		}
		this.setSetting('overlay_response_duration', String(seconds));
	}

	async loadInitialData() {
		// If WebSocket connected, request settings via requestSettings() which coalesces across windows
		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			if (typeof (window as any).__orchestratorSocket.requestSettings === 'function') {
				(window as any).__orchestratorSocket.requestSettings();
			} else {
				(window as any).__orchestratorSocket.send({ type: 'LOAD_SETTINGS' });
			}
			return;
		}
		try {
			const res = await fetch('http://127.0.0.1:4000/api/settings/load').catch(() => null);
			if (res && res.ok) {
				const data = await res.json();
				this.initFromSettings(data);
				return;
			}
			const [projectsRes, tabsRes] = await Promise.all([
				fetch('http://127.0.0.1:4000/api/projects').catch(() => null),
				fetch('http://127.0.0.1:4000/api/tabs').catch(() => null)
			]);
			if (projectsRes && projectsRes.ok && tabsRes && tabsRes.ok) {
				const projects = await projectsRes.json();
				const tabs = await tabsRes.json();
				this.initFromServer(projects, tabs);
			}
		} catch (err) {
			console.warn('[Harness] Could not load initial data via HTTP:', err);
		}
	}

	initFromServer(projects: any[], tabs: any[]) {
		if (Array.isArray(projects) && projects.length > 0) {
			this.serverProjects = projects;
			this.projects = projects.map((p) => p.name);
		}
		if (Array.isArray(tabs) && tabs.length > 0) {
			for (const t of tabs) {
				const existing = this.conversations.find((c) => c.id === t.id);
				const proj = this.serverProjects.find((p) => p.id === t.project_id);
				const groupName = proj ? proj.name : 'Discussions';
				if (existing) {
					existing.title = t.name || existing.title;
					existing.project_id = t.project_id;
					existing.group = groupName;
					existing.archived = !!t.archived;
					if (t.last_model) existing.model = t.last_model;
				} else {
					this.conversations.push({
						id: t.id,
						chatId: t.id,
						title: t.name || 'New Conversation',
						group: groupName,
						project_id: t.project_id,
						projectDirectory: proj?.directory_path,
						providerId: 'DeepSeek',
						model: t.last_model || this.selectedLlmModel || 'deepseek-v4-flash',
						messages: [],
						archived: !!t.archived,
						createdAt: t.created_at || Date.now(),
						updatedAt: t.updated_at || Date.now()
					});
				}
			}

			// Restore or set active tab (never restore into an archived thread)
			const savedActive = typeof localStorage !== 'undefined' ? localStorage.getItem('conclave_active_tab') : null;
			const target = (savedActive && this.conversations.find((c) => c.id === savedActive && !c.archived))
				? savedActive
				: (this.activeConversationId && this.conversations.find((c) => c.id === this.activeConversationId && !c.archived))
					? this.activeConversationId
					: this.conversations.find((c) => !c.archived)?.id;

			if (target) {
				this.activeConversationId = target;
				if (!this.openTabIds.includes(target)) {
					this.openTabIds = [target];
				}
				// Continuing the active conversation with its last-used model
				this.applyTabLastModel(this.conversations.find((c) => c.id === target));
				// Load last few days of chats for whichever tab is open (if not already loaded)
				const targetConv = this.conversations.find((c) => c.id === target);
				if (!targetConv || !targetConv.messages || targetConv.messages.length === 0) {
					this.fetchTabMessages(target, 7);
				}
			}
		}
	}

	handleTabCreated(tab: any) {
		if (!tab) return;
		const proj = this.serverProjects.find((p) => p.id === tab.project_id);
		const groupName = proj ? proj.name : 'Discussions';
		const existing = this.conversations.find((c) => c.id === tab.id);
		if (!existing) {
			const newConv: Conversation = {
				id: tab.id,
				chatId: tab.id,
				title: tab.name || 'New Conversation',
				group: groupName,
				project_id: tab.project_id,
				projectDirectory: proj?.directory_path,
				providerId: 'DeepSeek',
				model: this.selectedLlmModel || 'deepseek-v4-flash',
				messages: [],
				createdAt: tab.created_at || Date.now(),
				updatedAt: tab.updated_at || Date.now()
			};
			this.conversations.unshift(newConv);
			this.activeConversationId = newConv.id;
			if (!this.openTabIds.includes(newConv.id)) {
				this.openTabIds.push(newConv.id);
			}
		}
	}

	handleTabDetail(tabId: string, messages: any[]) {
		if (!tabId || !Array.isArray(messages)) return;
		let conv = this.conversations.find((c) => c.id === tabId);

		const formattedMessages = messages.map((m) => ({
			id: m.id,
			tabId: m.tab_id || tabId,
			role: m.role,
			content: m.content,
			attachments: m.attachments,
			model: m.model,
			totalTokens: m.totalTokens ?? m.usage?.totalTokens,
			usage: m.usage,
			toolSteps: m.tool_steps?.map((s: any) => ({
				id: s.id,
				name: s.title,
				count: s.badge_count || 1,
				status: s.status === 'done' ? 'completed' : 'running',
				details: (s.details || []).map((d: any) => ({
					title: d.action,
					content: d.detail || '',
					status: d.status === 'done' ? 'success' : 'info'
				}))
			})),
			createdAt: m.created_at
		}));

		if (conv) {
			conv.messages = formattedMessages;
		} else {
			const projId = this.serverProjects[0]?.id || '112';
			conv = {
				id: tabId,
				chatId: tabId,
				title: 'Conversation',
				group: 'Discussions',
				project_id: projId,
				providerId: 'DeepSeek',
				model: this.selectedLlmModel || 'deepseek-v4-flash',
				messages: formattedMessages,
				createdAt: Date.now(),
				updatedAt: Date.now()
			};
			this.conversations.unshift(conv);
		}

		if (!this.openTabIds.includes(tabId)) {
			this.openTabIds.push(tabId);
		}

		// Reassign conversations array to guarantee Svelte 5 reactivity updates immediately
		this.conversations = [...this.conversations];
	}

	createConversation(group = 'Discussions', dir?: string, providerId?: string, model?: string) {
		const effectiveDir = dir !== undefined ? dir.trim() : this.lastProjectDirectory;
		if (effectiveDir && typeof localStorage !== 'undefined') {
			this.lastProjectDirectory = effectiveDir;
			localStorage.setItem('conclave_last_project_dir', effectiveDir);
		}

		const chosenProvider = providerId || this.selectedLlmProvider || 'DeepSeek';
		const chosenModel = model || this.selectedLlmModel || 'deepseek-v4-flash';
		const proj = this.serverProjects.find((p) => p.name === group);
		const projectId = proj ? proj.id : (this.serverProjects[0]?.id || '112');

		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			(window as any).__orchestratorSocket.send({
				type: 'TAB_CREATE',
				projectId,
				name: 'New Conversation'
			});
			this.showNewChatModal = false;
			return;
		}

		const timestamp = Date.now();
		const chatId = `tab-${timestamp}`;

		const newConv: Conversation = {
			id: chatId,
			chatId: chatId,
			title: 'New Conversation',
			group: group,
			project_id: projectId,
			projectDirectory: effectiveDir || undefined,
			providerId: chosenProvider,
			model: chosenModel,
			messages: [],
			createdAt: timestamp,
			updatedAt: timestamp
		};

		this.conversations.unshift(newConv);
		this.activeConversationId = newConv.id;
		if (!this.openTabIds.includes(newConv.id)) {
			this.openTabIds.push(newConv.id);
		}
		this.showNewChatModal = false;
		return newConv;
	}

	updateConversationTitle(id: string, title: string) {
		const conv = this.conversations.find((c) => c.id === id);
		if (conv) {
			conv.title = title;
			conv.updatedAt = Date.now();
		}
	}

	/** Rename a thread: persists server-side (TAB_RENAME) and updates every window via broadcast. */
	renameConversation(id: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed || !id) return;
		this.updateConversationTitle(id, trimmed);
		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			(window as any).__orchestratorSocket.send({ type: 'TAB_RENAME', tabId: id, name: trimmed });
		}
	}

	/** Archive or unarchive a thread. Archived threads leave the lists but keep their data. */
	archiveConversation(id: string, archived: boolean) {
		const conv = this.conversations.find((c) => c.id === id);
		if (conv) conv.archived = archived;
		if (archived) this.closeTab(id);
		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			(window as any).__orchestratorSocket.send({ type: 'TAB_ARCHIVE', tabId: id, archived });
		}
	}

	/** Broadcast handler: another window archived/unarchived this thread. */
	handleTabArchived(tabId: string, archived: boolean) {
		const conv = this.conversations.find((c) => c.id === tabId || c.chatId === tabId);
		if (conv) conv.archived = archived;
		if (archived) this.closeTab(tabId);
	}

	/** Export a thread as a markdown file download. */
	downloadConversation(id: string) {
		const conv = this.conversations.find((c) => c.id === id);
		if (!conv) return;
		const stamp = new Date().toISOString().slice(0, 10);
		const lines: string[] = [
			`# ${conv.title}`,
			'',
			`_${conv.group} · exported ${stamp} · ${conv.messages.length} messages_`,
			''
		];
		for (const m of conv.messages) {
			const who = m.role === 'user' ? 'You' : `Assistant${m.model ? ` (${m.model})` : ''}`;
			lines.push(`## ${who}`, '', m.content || '*(empty)*', '');
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${conv.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'thread'}.md`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	deleteConversation(id: string) {
		this.conversations = this.conversations.filter((c) => c.id !== id);
		this.closeTab(id);
		if (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected') {
			(window as any).__orchestratorSocket.send({
				type: 'TAB_DELETE',
				tabId: id
			});
		} else {
			fetch(`http://127.0.0.1:4000/api/tabs/${id}`, { method: 'DELETE' }).catch(() => {});
		}
	}

	handleTabDeleted(tabId: string) {
		this.conversations = this.conversations.filter((c) => c.id !== tabId);
		this.closeTab(tabId);
	}

	async sendMessage(content: string, attachments?: Attachment[]) {
		const hasAttachments = attachments && attachments.length > 0;
		const trimmedContent = content.trim();
		if (!trimmedContent && !hasAttachments) return;
		if (!this.activeConversation) return;

		const conv = this.activeConversation;
		const effectiveContent = trimmedContent || (hasAttachments ? 'Please review and analyze the attached file(s).' : '');

		const userMsg: Message = {
			id: 'msg-' + Date.now(),
			role: 'user',
			content: effectiveContent,
			attachments: hasAttachments ? attachments : undefined,
			createdAt: Date.now()
		};

		conv.messages.push(userMsg);
		conv.updatedAt = Date.now();

		// Auto-title conversation if first user message
		if (conv.messages.filter((m) => m.role === 'user').length === 1 && conv.title === 'New Conversation') {
			conv.title = (effectiveContent || (attachments && attachments[0] ? attachments[0].name : 'Chat')).slice(0, 32);
		}

		this.isGenerating = true;

		// 1. If inside Tauri or WebSocket connected, stream directly via WebSocket
		if (isTauriEnvironment() || (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected')) {
			const assistantMsg: Message = {
				id: 'msg-' + (Date.now() + 1),
				role: 'assistant',
				providerId: conv.providerId,
				model: conv.model,
				content: '',
				toolSteps: [],
				createdAt: Date.now()
			};
			conv.messages.push(assistantMsg);

			(window as any).__orchestratorSocket?.send({
				type: 'PROMPT_SEND',
				tabId: conv.id,
				chatId: conv.chatId || conv.id,
				conversationId: conv.id,
				content: effectiveContent,
				attachments: hasAttachments ? attachments : undefined,
				provider: this.selectedLlmProvider || conv.providerId || 'DeepSeek',
				model: this.selectedLlmModel || conv.model || 'Deepseek v4',
				projectDirectory: conv.projectDirectory
			});
			return;
		}

		try {
			// Call the Bun router endpoint (/api/chat) as fallback
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					conversationId: conv.id,
					chatId: conv.chatId || conv.id,
					providerId: conv.providerId,
					model: conv.model,
					messages: conv.messages,
					settings: this.settings
				})
			});

			if (!response.ok) {
				throw new Error(`Server returned ${response.status}: ${response.statusText}`);
			}

			// Prepare assistant placeholder message
			const assistantMsg: Message = {
				id: 'msg-' + (Date.now() + 1),
				role: 'assistant',
				providerId: conv.providerId,
				model: conv.model,
				content: '',
				toolSteps: [],
				createdAt: Date.now()
			};
			conv.messages.push(assistantMsg);

			// Handle streaming or JSON response from Bun router
			const contentType = response.headers.get('content-type') || '';
			if (contentType.includes('text/event-stream') && response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const dataStr = line.slice(6).trim();
							if (dataStr === '[DONE]') continue;
							try {
								const parsed = JSON.parse(dataStr);
								if (parsed.content) {
									assistantMsg.content += parsed.content;
								}
								if (parsed.toolStep) {
									if (!assistantMsg.toolSteps) assistantMsg.toolSteps = [];
									const existing = assistantMsg.toolSteps.find((s) => s.id === parsed.toolStep.id);
									if (existing) {
										Object.assign(existing, parsed.toolStep);
									} else {
										assistantMsg.toolSteps.push(parsed.toolStep);
									}
								}
							} catch (e) {
								// Plain text fallback
								assistantMsg.content += dataStr;
							}
						}
					}
				}
			} else {
				const data = await response.json();
				if (data.content) {
					assistantMsg.content = data.content;
				}
				if (data.toolSteps) {
					assistantMsg.toolSteps = data.toolSteps;
				}
			}
		} catch (error: any) {
			console.error('Failed to send message to Bun router:', error);
			conv.messages.push({
				id: 'msg-err-' + Date.now(),
				role: 'assistant',
				providerId: conv.providerId,
				model: conv.model,
				content: `*Error communicating with Bun router*: ${error.message || 'Connection failed'}. You can adjust the router endpoint in Settings [🎛].`,
				createdAt: Date.now()
			});
		} finally {
			this.isGenerating = false;
		}
	}
}

export const harness = new HarnessStore();
