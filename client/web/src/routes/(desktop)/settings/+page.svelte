<script lang="ts">
	import { onMount } from 'svelte';
	import { harness } from '$lib/stores/harness.svelte';
	import { orchestratorSocket } from '$lib/services/orchestratorSocket.svelte';
	import { handleWindowDrag } from '$lib/utils/drag';
	import type { ModelInfo } from '$lib/types';
	import {
		ArrowLeft,
		SlidersHorizontal,
		Cpu,
		Server,
		Sparkles,
		RefreshCw,
		ExternalLink,
		Layers,
		CheckCircle2,
		AlertCircle,
		Minimize2,
		Copy,
		Check,
		Terminal,
		Network,
		Code,
		Bot
	} from '@lucide/svelte';

	// === Tab Selection ===
	type SettingsTab = 'mcp' | 'general' | 'plugins' | 'engine';
	let activeTab = $state<SettingsTab>('mcp');

	// === MCP Configuration State ===
	type McpPathMode = 'app' | 'dev';
	let mcpPathMode = $state<McpPathMode>('app');

	// This build targets Windows and Linux only. The stdio bridge ships beside
	// the Conclave executable (production) or in the repo checkout (development);
	// the client cannot discover either absolute path at runtime, so the install
	// folder stays a placeholder the user fills in.
	const isWindows =
		typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

	const PROD_MCP_BIN = `<Conclave install folder>/${isWindows ? 'conclave-mcp.exe' : 'conclave-mcp'}`;
	const DEV_MCP_SCRIPT = '<Conclave repo>/orchestrator/bin/mcp-server.js';

	const CLAUDE_CONFIG_PATH = isWindows
		? '%APPDATA%\\Claude\\claude_desktop_config.json'
		: '~/.config/Claude/claude_desktop_config.json';

	const CURSOR_MCP_PATH = isWindows ? '%USERPROFILE%\\.cursor\\mcp.json' : '~/.cursor/mcp.json';

	const activeRunCommand = $derived(
		mcpPathMode === 'app' ? PROD_MCP_BIN : `node ${DEV_MCP_SCRIPT}`
	);

	const mcpConfigObj = $derived(
		mcpPathMode === 'app'
			? {
					mcpServers: {
						conclave: {
							command: PROD_MCP_BIN
						}
					}
			  }
			: {
					mcpServers: {
						conclave: {
							command: 'node',
							args: [DEV_MCP_SCRIPT]
						}
					}
			  }
	);

	const mcpConfigJson = $derived(JSON.stringify(mcpConfigObj, null, 2));

	const mcpLlmPrompt = $derived(
`Please configure Conclave as an MCP server in my MCP settings file:

${mcpConfigJson}`
	);

	// Copy feedback states
	let copiedPrompt = $state(false);
	let copiedJson = $state(false);
	let copiedClaudeCmd = $state(false);
	let copiedTestCmd = $state(false);

	async function copyText(text: string, type: 'prompt' | 'json' | 'claude' | 'test') {
		try {
			await navigator.clipboard.writeText(text);
			if (type === 'prompt') {
				copiedPrompt = true;
				setTimeout(() => (copiedPrompt = false), 2000);
			} else if (type === 'json') {
				copiedJson = true;
				setTimeout(() => (copiedJson = false), 2000);
			} else if (type === 'claude') {
				copiedClaudeCmd = true;
				setTimeout(() => (copiedClaudeCmd = false), 2000);
			} else if (type === 'test') {
				copiedTestCmd = true;
				setTimeout(() => (copiedTestCmd = false), 2000);
			}
		} catch (err) {
			console.error('Failed to copy to clipboard:', err);
		}
	}

	// === Plugins (MCP servers / process plugins) ===
	let pluginUrlInput = $state('');
	let pluginBusy = $state(false);

	function refreshPlugins() {
		orchestratorSocket.send({ type: 'PLUGIN_LIST' });
	}

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const tab = params.get('tab');
		if (tab && ['mcp', 'general', 'plugins', 'engine'].includes(tab)) {
			activeTab = tab as SettingsTab;
		}
		refreshPlugins();
	});

	function installPluginFromUrl() {
		const url = pluginUrlInput.trim();
		if (!url || pluginBusy) return;
		pluginBusy = true;
		orchestratorSocket.send({ type: 'PLUGIN_INSTALL', url });
		pluginUrlInput = '';
		setTimeout(() => (pluginBusy = false), 1500);
	}

	function togglePlugin(id: string, enabled: boolean) {
		orchestratorSocket.send({ type: 'PLUGIN_TOGGLE', id, enabled });
	}

	function removePlugin(id: string) {
		orchestratorSocket.send({ type: 'PLUGIN_REMOVE', id });
	}

	function getProviderBadgeColor(provider: string) {
		const p = provider.toLowerCase();
		if (p.includes('deepseek')) return 'text-cyan-400 bg-cyan-950/50 border-cyan-800/60';
		if (p.includes('qwen')) return 'text-purple-400 bg-purple-950/50 border-purple-800/60';
		if (p.includes('claude')) return 'text-amber-400 bg-amber-950/50 border-amber-800/60';
		return 'text-zinc-400 bg-zinc-900 border-zinc-700/60';
	}
</script>

<svelte:head>
	<title>Settings — Conclave</title>
</svelte:head>

<div class="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
	<!-- Header Bar matching app chrome with back button & drag region -->
	<header
		data-tauri-drag-region
		onmousedown={handleWindowDrag}
		class="h-12 flex items-center justify-between px-6 border-b border-zinc-800/80 bg-zinc-950/80 select-none flex-shrink-0 cursor-default"
	>
		<div data-tauri-drag-region class="flex items-center gap-3">
			<a
				href="/"
				class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 text-xs transition-colors cursor-pointer shadow-sm"
				title="Return to conversation view"
			>
				<ArrowLeft class="w-3.5 h-3.5" />
				<span>Back to Chat</span>
			</a>
		</div>

		<!-- Orchestrator Socket Status Pill & Shrink Window Button -->
		<div class="flex items-center gap-2">
			<div
				class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono select-none {orchestratorSocket.status === 'connected'
					? 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60'
					: 'bg-zinc-900 text-zinc-500 border-zinc-800'}"
			>
				<span
					class="w-1.5 h-1.5 rounded-full {orchestratorSocket.status === 'connected'
						? 'bg-emerald-400 animate-pulse'
						: 'bg-zinc-600'}"
				></span>
				<span>ws://127.0.0.1:4000 ({orchestratorSocket.status})</span>
			</div>

			<button
				type="button"
				onclick={() => harness.enterMinimalistMode()}
				class="p-1.5 rounded-md text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/80 transition-colors cursor-pointer border border-transparent hover:border-zinc-700/60"
				title="Minimize to HUD Mode"
			>
				<Minimize2 class="w-4 h-4" />
			</button>
		</div>
	</header>

	<!-- Top Tab Navigation Bar -->
	<div class="flex items-center gap-1 px-8 pt-2.5 border-b border-zinc-800/80 bg-zinc-950/60 select-none flex-shrink-0">
		<button
			type="button"
			onclick={() => (activeTab = 'mcp')}
			class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 cursor-pointer {activeTab === 'mcp'
				? 'border-cyan-400 text-cyan-300 bg-zinc-900/60'
				: 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'}"
		>
			<Network class="w-3.5 h-3.5 text-cyan-400" />
			<span>MCP</span>
			<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/60 text-cyan-400 font-mono font-semibold uppercase tracking-wider">
				Active
			</span>
		</button>

		<button
			type="button"
			onclick={() => (activeTab = 'general')}
			class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 cursor-pointer {activeTab === 'general'
				? 'border-cyan-400 text-cyan-300 bg-zinc-900/60'
				: 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'}"
		>
			<SlidersHorizontal class="w-3.5 h-3.5" />
			<span>General</span>
		</button>

		<button
			type="button"
			onclick={() => (activeTab = 'plugins')}
			class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 cursor-pointer {activeTab === 'plugins'
				? 'border-cyan-400 text-cyan-300 bg-zinc-900/60'
				: 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'}"
		>
			<Layers class="w-3.5 h-3.5" />
			<span>Plugins</span>
			<span class="text-[10px] text-zinc-500 font-mono">({harness.plugins.length})</span>
		</button>

		<button
			type="button"
			onclick={() => (activeTab = 'engine')}
			class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg transition-all border-b-2 cursor-pointer {activeTab === 'engine'
				? 'border-cyan-400 text-cyan-300 bg-zinc-900/60'
				: 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30'}"
		>
			<Server class="w-3.5 h-3.5" />
			<span>Engine & System</span>
		</button>
	</div>

	<!-- Scrollable Content Body -->
	<div class="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-8 select-none text-xs text-zinc-300">
		<!-- ==================== TAB 1: MCP ==================== -->
		{#if activeTab === 'mcp'}
			<!-- Intro Banner -->
			<div class="p-5 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-zinc-900/60 to-zinc-900/40 border border-cyan-800/40 space-y-2">
				<div class="flex items-center gap-2.5">
					<div class="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
						<Network class="w-5 h-5" />
					</div>
					<div>
						<h2 class="text-base font-semibold text-zinc-100">Model Context Protocol (MCP) Integration</h2>
						<p class="text-zinc-400 text-xs">
							Expose Conclave's local LLMs, chat tabs, and filesystem tools to Claude Desktop, Cursor, Zed, and Windsurf.
						</p>
					</div>
				</div>

				<div class="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
					<div class="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-between">
						<span class="text-zinc-500">JSON-RPC Endpoint:</span>
						<span class="text-cyan-400">:4000/mcp</span>
					</div>
					<div class="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-between">
						<span class="text-zinc-500">Stdio Transport:</span>
						<span class="text-emerald-400 font-semibold">Ready</span>
					</div>
					<div class="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800/70 flex items-center justify-between">
						<span class="text-zinc-500">Active Tools:</span>
						<span class="text-zinc-200">6 tools</span>
					</div>
				</div>
			</div>

			<!-- Card 1: Prompt AI Assistant -->
			<section class="p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Bot class="w-4 h-4 text-cyan-400" />
						<h3 class="text-sm font-semibold text-zinc-100">1. Instruct Your AI Assistant (Terminal / Chat)</h3>
					</div>
					<button
						type="button"
						onclick={() => copyText(mcpLlmPrompt, 'prompt')}
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95"
					>
						{#if copiedPrompt}
							<Check class="w-3.5 h-3.5 text-emerald-400" />
							<span class="text-emerald-300">Copied Prompt!</span>
						{:else}
							<Copy class="w-3.5 h-3.5" />
							<span>Copy AI Prompt</span>
						{/if}
					</button>
				</div>

				<p class="text-[11px] text-zinc-400 leading-relaxed">
					Paste this prompt into Claude Desktop, Cursor, Antigravity, or your terminal AI to automatically configure the MCP server:
				</p>

				<div class="relative rounded-xl bg-zinc-950/90 border border-zinc-800 p-3.5 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap select-all">
					{mcpLlmPrompt}
				</div>
			</section>

			<!-- Card 2: Direct MCP Configuration Snippet -->
			<section class="p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
				<div class="flex items-center justify-between flex-wrap gap-2">
					<div class="flex items-center gap-2">
						<Code class="w-4 h-4 text-cyan-400" />
						<h3 class="text-sm font-semibold text-zinc-100">2. Configuration File Snippet</h3>
					</div>

					<!-- Environment Path Toggle (Production vs Development) & Copy -->
					<div class="flex items-center gap-2">
						<div class="flex items-center p-0.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[10px]">
							<button
								type="button"
								onclick={() => (mcpPathMode = 'app')}
								class="px-2.5 py-1 rounded-md transition-colors cursor-pointer {mcpPathMode === 'app'
									? 'bg-zinc-800 text-cyan-300 font-semibold shadow-sm'
									: 'text-zinc-500 hover:text-zinc-300'}"
								title="Slim native proxy (~500KB) bundled inside the app folder — passes logic off to orchestrator (no Node.js required)"
							>
								Production (bundled)
							</button>
							<button
								type="button"
								onclick={() => (mcpPathMode = 'dev')}
								class="px-2.5 py-1 rounded-md transition-colors cursor-pointer {mcpPathMode === 'dev'
									? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm'
									: 'text-zinc-500 hover:text-zinc-300'}"
								title="Node.js proxy script in local git repository"
							>
								Development (Node.js)
							</button>
						</div>

						<button
							type="button"
							onclick={() => copyText(mcpConfigJson, 'json')}
							class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium transition-all cursor-pointer active:scale-95"
						>
							{#if copiedJson}
								<Check class="w-3.5 h-3.5 text-emerald-400" />
								<span class="text-emerald-300">Copied JSON!</span>
							{:else}
								<Copy class="w-3.5 h-3.5" />
								<span>Copy JSON</span>
							{/if}
						</button>
					</div>
				</div>

				<p class="text-[11px] text-zinc-400 leading-relaxed">
					Add this <code class="text-cyan-300 bg-zinc-800/80 px-1 py-0.5 rounded font-mono">conclave</code> server block to your client's MCP configuration file:
				</p>

				<div class="relative rounded-xl bg-zinc-950/90 border border-zinc-800 p-3.5 font-mono text-[11px] text-zinc-200 leading-relaxed overflow-x-auto select-all">
					{mcpConfigJson}
				</div>
			</section>

			<!-- Card 3: Client File Paths -->
			<section class="p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-4">
				<div class="flex items-center gap-2 pb-1 border-b border-zinc-800/60">
					<Terminal class="w-4 h-4 text-cyan-400" />
					<h3 class="text-sm font-semibold text-zinc-100">3. Configuration File Locations by Client</h3>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					<!-- Claude Desktop -->
					<div class="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
								<span class="w-2 h-2 rounded-full bg-amber-400"></span>
								Claude Desktop
							</span>
							<button
								type="button"
								onclick={() => copyText(CLAUDE_CONFIG_PATH, 'claude')}
								class="text-[10px] text-zinc-400 hover:text-cyan-300 flex items-center gap-1 font-mono transition-colors cursor-pointer"
								title="Copy configuration file path"
							>
								{#if copiedClaudeCmd}
									<Check class="w-3 h-3 text-emerald-400" />
									<span class="text-emerald-300">Copied path</span>
								{:else}
									<Copy class="w-3 h-3" />
									<span>copy path</span>
								{/if}
							</button>
						</div>
						<div class="p-2 rounded bg-zinc-900 border border-zinc-800/80 font-mono text-[10px] text-zinc-400 break-all select-all">
							{CLAUDE_CONFIG_PATH}
						</div>
						<p class="text-[10px] text-zinc-500">
							Paste the JSON block into <code class="text-zinc-400">mcpServers</code> and restart Claude Desktop.
						</p>
					</div>

					<!-- Cursor -->
					<div class="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
								<span class="w-2 h-2 rounded-full bg-cyan-400"></span>
								Cursor
							</span>
							<span class="text-[10px] text-zinc-500 font-mono">Settings &gt; Features &gt; MCP</span>
						</div>
						<div class="p-2 rounded bg-zinc-900 border border-zinc-800/80 font-mono text-[10px] text-zinc-400 break-all select-all">
							{CURSOR_MCP_PATH}
						</div>
						<p class="text-[10px] text-zinc-500">
							{#if mcpPathMode === 'app'}
								Click "Add New MCP Server" with command: <code class="text-cyan-300 font-mono">{PROD_MCP_BIN}</code> and args: <code class="text-zinc-400">[]</code>.
							{:else}
								Click "Add New MCP Server" with command: <code class="text-zinc-400 font-mono">node</code> and argument: <code class="text-zinc-400 font-mono">{DEV_MCP_SCRIPT}</code>.
							{/if}
						</p>
					</div>

					<!-- Windsurf / Zed / VSCode -->
					<div class="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-2 md:col-span-2">
						<div class="flex items-center justify-between">
							<span class="font-semibold text-zinc-200 text-xs flex items-center gap-1.5">
								<span class="w-2 h-2 rounded-full bg-purple-400"></span>
								Windsurf, Zed, Cline & Antigravity
							</span>
							<span class="text-[10px] text-zinc-500 font-mono">Standard MCP Stdio</span>
						</div>
						<p class="text-[10px] text-zinc-400 leading-relaxed">
							Any client supporting the Model Context Protocol stdio specification can run <code class="text-zinc-300 font-mono">{activeRunCommand}</code> directly. All requests are routed to the Conclave orchestrator at <code class="text-cyan-300 font-mono">http://127.0.0.1:4000/mcp</code>.
						</p>
					</div>
				</div>
			</section>

			<!-- Card 4: Registered MCP Tools & Tab Routing -->
			<section class="p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
				<div class="flex items-center justify-between pb-1 border-b border-zinc-800/60">
					<div class="flex items-center gap-2">
						<Sparkles class="w-4 h-4 text-cyan-400" />
						<h3 class="text-sm font-semibold text-zinc-100">4. Active MCP Tools & Tab Destinations</h3>
					</div>
					<span class="text-[10px] font-mono text-zinc-500">Direct tab persistence</span>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
					<div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-1">
						<div class="flex items-center justify-between">
							<span class="font-mono text-xs font-semibold text-cyan-300">plugin_danyapi_ask_deepseek</span>
							<span class="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 font-mono">
								tab: deepseek
							</span>
						</div>
						<p class="text-[10px] text-zinc-400">
							Queries DeepSeek V4 through DanyAPI. Automatically creates and appends conversation history in the <strong>deepseek</strong> tab.
						</p>
					</div>

					<div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-1">
						<div class="flex items-center justify-between">
							<span class="font-mono text-xs font-semibold text-purple-300">plugin_danyapi_ask_qwen</span>
							<span class="text-[9px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800/60 font-mono">
								tab: qwen
							</span>
						</div>
						<p class="text-[10px] text-zinc-400">
							Queries Qwen 3.7+ through DanyAPI. Automatically creates and appends conversation history in the <strong>qwen</strong> tab.
						</p>
					</div>

					<div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-1">
						<div class="flex items-center justify-between">
							<span class="font-mono text-xs font-semibold text-zinc-200">run_command</span>
							<span class="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 font-mono">
								host tool
							</span>
						</div>
						<p class="text-[10px] text-zinc-400">
							Executes shell commands within the project environment with stdout/stderr capture and timeout guard.
						</p>
					</div>

					<div class="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/70 space-y-1">
						<div class="flex items-center justify-between">
							<span class="font-mono text-xs font-semibold text-zinc-200">read_file / write_file</span>
							<span class="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/60 font-mono">
								fs tool
							</span>
						</div>
						<p class="text-[10px] text-zinc-400">
							Safely inspects and modifies project files within workspace boundaries.
						</p>
					</div>
				</div>
			</section>

			<!-- Card 5: Terminal Test Command -->
			<section class="p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Terminal class="w-4 h-4 text-emerald-400" />
						<h3 class="text-sm font-semibold text-zinc-100">5. Test MCP Connection in Terminal</h3>
					</div>
					<button
						type="button"
						onclick={() => copyText(`echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | ${activeRunCommand} | jq .`, 'test')}
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-medium transition-all cursor-pointer active:scale-95"
					>
						{#if copiedTestCmd}
							<Check class="w-3.5 h-3.5 text-emerald-400" />
							<span class="text-emerald-300">Copied Test!</span>
						{:else}
							<Copy class="w-3.5 h-3.5" />
							<span>Copy Command</span>
						{/if}
					</button>
				</div>

				<div class="relative rounded-xl bg-zinc-950/90 border border-zinc-800 p-3 font-mono text-[10px] text-zinc-300 overflow-x-auto select-all">
					echo '{`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`}' | {activeRunCommand} | jq .
				</div>
			</section>

		<!-- ==================== TAB 2: GENERAL ==================== -->
		{:else if activeTab === 'general'}
			<!-- Section: Available Models -->
			<section class="space-y-3">
				<div class="flex items-center justify-between pb-2 border-b border-zinc-800/60">
					<div class="flex items-center gap-2">
						<Sparkles class="w-4 h-4 text-cyan-400" />
						<h2 class="text-sm font-semibold text-zinc-100">Available Models</h2>
						<span class="text-[10px] text-zinc-500 font-mono">({harness.availableModels.length} from plugins)</span>
					</div>
					<span class="text-[11px] text-zinc-400 font-mono">
						Active: <strong class="text-zinc-200">{harness.selectedLlmModel || 'deepseek-v4-flash'}</strong>
					</span>
				</div>

				<div class="rounded-xl bg-zinc-900/30 border border-zinc-800/50 divide-y divide-zinc-800/40">
					{#each harness.availableModels as model (model.id + model.provider)}
						<div class="flex items-center justify-between px-3 py-1.5">
							<span class="font-mono text-[11px] text-zinc-200 truncate">{model.id}</span>
							<span
								class="text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-tight flex-shrink-0 ml-2 {getProviderBadgeColor(model.provider)}"
							>
								[{model.provider}]
							</span>
						</div>
					{/each}
					{#if harness.availableModels.length === 0}
						<div class="px-3 py-2 text-[10px] text-zinc-500">No models — install a plugin that provides models.</div>
					{/if}
				</div>
			</section>

			<!-- Section: Model Sampling Parameters -->
			<section class="space-y-4">
				<div class="pb-2 border-b border-zinc-800/60 flex items-center gap-2">
					<SlidersHorizontal class="w-4 h-4 text-cyan-400" />
					<h2 class="text-sm font-semibold text-zinc-100">Sampling Parameters</h2>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<!-- Temperature -->
					<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-2">
						<div class="flex items-center justify-between">
							<label for="temp-slider" class="font-medium text-zinc-200 text-xs">Temperature</label>
							<span class="font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
								{harness.settings.temperature}
							</span>
						</div>
						<input
							id="temp-slider"
							type="range"
							min="0"
							max="1.5"
							step="0.05"
							bind:value={harness.settings.temperature}
							onchange={() => harness.setSetting('temperature', harness.settings.temperature)}
							class="w-full accent-cyan-400 bg-zinc-800 cursor-pointer h-1.5 rounded"
						/>
						<p class="text-[10px] text-zinc-500 leading-tight">
							Controls randomness. Lower values are deterministic and focused; higher values encourage creativity.
						</p>
					</div>

					<!-- Max Output Tokens -->
					<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-2">
						<div class="flex items-center justify-between">
							<label for="tokens-slider" class="font-medium text-zinc-200 text-xs">Max Output Tokens</label>
							<span class="font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40 text-[11px]">
								{harness.settings.maxTokens}
							</span>
						</div>
						<input
							id="tokens-slider"
							type="range"
							min="512"
							max="8192"
							step="256"
							bind:value={harness.settings.maxTokens}
							onchange={() => harness.setSetting('max_tokens', harness.settings.maxTokens)}
							class="w-full accent-cyan-400 bg-zinc-800 cursor-pointer h-1.5 rounded"
						/>
						<p class="text-[10px] text-zinc-500 leading-tight">
							Maximum number of generated tokens per response (up to 8,192 tokens for long form reasoning).
						</p>
					</div>
				</div>

				<!-- Streaming SSE Toggle -->
				<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 flex items-center justify-between">
					<div>
						<div class="font-medium text-zinc-200 text-xs">Streaming SSE</div>
						<p class="text-[10px] text-zinc-500 mt-0.5">
							Stream partial tokens in real-time as the model generates output.
						</p>
					</div>
					<button
						type="button"
						aria-label="Toggle streaming SSE"
						onclick={() => (harness.settings.stream = !harness.settings.stream)}
						class="w-9 h-5 rounded-full transition-colors relative cursor-pointer {harness.settings.stream ? 'bg-cyan-500' : 'bg-zinc-800'}"
					>
						<span
							class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-zinc-950 transition-transform {harness.settings.stream ? 'translate-x-4' : ''}"
						></span>
					</button>
				</div>

				<!-- Overlay Response Display Duration -->
				<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-2">
					<div class="flex items-center justify-between">
						<div>
							<div class="font-medium text-zinc-200 text-xs">Overlay Response Display Duration</div>
							<p class="text-[10px] text-zinc-500 mt-0.5">
								Duration to show AI responses in the HUD overlay before automatically collapsing back to the brain icon.
							</p>
						</div>
						<span class="font-mono text-cyan-400 text-xs font-semibold px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40">
							{harness.settings.overlayResponseDuration ?? 15}s
						</span>
					</div>
					<div class="flex items-center gap-3 pt-1">
						<input
							type="range"
							min="3"
							max="60"
							step="1"
							value={harness.settings.overlayResponseDuration ?? 15}
							oninput={(e) => harness.setOverlayResponseDuration(Number((e.target as HTMLInputElement).value))}
							class="w-full accent-cyan-400 cursor-pointer"
						/>
						<span class="text-[10px] text-zinc-500 font-mono w-8 text-right">
							{harness.settings.overlayResponseDuration ?? 15}s
						</span>
					</div>
				</div>
			</section>

		<!-- ==================== TAB 3: PLUGINS ==================== -->
		{:else if activeTab === 'plugins'}
			<section class="space-y-3">
				<div class="pb-2 border-b border-zinc-800/60 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Layers class="w-4 h-4 text-cyan-400" />
						<h2 class="text-sm font-semibold text-zinc-100">Plugins — MCP Servers & Tools</h2>
					</div>
					<button
						type="button"
						onclick={refreshPlugins}
						class="p-1.5 rounded-md text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/80 transition-colors cursor-pointer"
						title="Refresh plugin list"
					>
						<RefreshCw class="w-3.5 h-3.5" />
					</button>
				</div>

				<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
					<!-- Install from git URL -->
					<div class="flex items-center gap-2">
						<input
							type="text"
							bind:value={pluginUrlInput}
							onkeydown={(e) => e.key === 'Enter' && installPluginFromUrl()}
							placeholder="https://github.com/user/my-plugin.git (repo with plugin.json)"
							class="flex-1 bg-zinc-900/90 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-cyan-500/50 font-mono"
						/>
						<button
							type="button"
							onclick={installPluginFromUrl}
							disabled={!pluginUrlInput.trim() || pluginBusy}
							class="px-2.5 py-1.5 rounded-lg bg-cyan-500/90 hover:bg-cyan-400 disabled:opacity-30 text-zinc-950 text-[11px] font-semibold transition-all cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
						>
							{pluginBusy ? 'Installing…' : 'Install'}
						</button>
					</div>

					{#if harness.pluginError}
						<div class="px-2.5 py-1.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-[10px] text-rose-300 font-mono">
							{harness.pluginError}
						</div>
					{/if}

					{#if harness.plugins.length === 0}
						<p class="text-[10px] text-zinc-500 leading-relaxed">
							No plugins installed. Install an MCP server plugin to extend the assistant with external tools —
							tools appear automatically on the orchestrator's MCP endpoint (http://127.0.0.1:4000/mcp).
						</p>
					{:else}
						{#each harness.plugins as plugin (plugin.id)}
							<div class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
								<div class="flex items-center gap-2.5 min-w-0">
									<span
										class="w-2 h-2 rounded-full flex-shrink-0 {plugin.status === 'running'
											? 'bg-emerald-400'
											: plugin.status === 'starting'
												? 'bg-amber-400 animate-pulse'
												: plugin.status === 'failed'
													? 'bg-rose-500'
													: 'bg-zinc-600'}"
										title={plugin.error || plugin.status}
									></span>
									<div class="min-w-0">
										<div class="text-xs text-zinc-100 font-medium truncate">{plugin.name}</div>
										<div class="text-[10px] text-zinc-500 font-mono truncate">
											{plugin.id} · {plugin.type}
											{#if plugin.tools?.length}
												· {plugin.tools.length} tool{plugin.tools.length === 1 ? '' : 's'}
											{/if}
											{#if plugin.models?.length}
												· {plugin.models.length} model{plugin.models.length === 1 ? '' : 's'}
											{/if}
											{#if plugin.error}
												· <span class="text-rose-400">{plugin.error}</span>
											{/if}
										</div>
									</div>
								</div>
								<div class="flex items-center gap-2 flex-shrink-0">
									<label class="flex items-center gap-1.5 cursor-pointer" title={plugin.enabled ? 'Disable' : 'Enable'}>
										<input
											type="checkbox"
											checked={plugin.enabled}
											onchange={(e) => togglePlugin(plugin.id, e.currentTarget.checked)}
											class="accent-cyan-500 w-3 h-3 cursor-pointer"
										/>
										<span class="text-[10px] text-zinc-400">{plugin.enabled ? 'On' : 'Off'}</span>
									</label>
									<button
										type="button"
										onclick={() => removePlugin(plugin.id)}
										class="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
										title="Remove plugin"
									>
										<AlertCircle class="w-3.5 h-3.5" />
									</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</section>

		<!-- ==================== TAB 4: ENGINE & SYSTEM ==================== -->
		{:else if activeTab === 'engine'}
			<!-- Section: Engine Infrastructure & Local Containers -->
			<section class="space-y-3">
				<div class="pb-2 border-b border-zinc-800/60 flex items-center gap-2">
					<Server class="w-4 h-4 text-cyan-400" />
					<h2 class="text-sm font-semibold text-zinc-100">Local Containers & Engine Status</h2>
				</div>

				<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2.5">
							<div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
							<div>
								<div class="font-medium text-zinc-100 text-xs">DanyAPI (Self-Contained Docker Container)</div>
								<div class="text-[10px] text-zinc-500 font-mono">http://127.0.0.1:8000/v1</div>
							</div>
						</div>
						<span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50 font-mono text-[10px]">
							Docker Active
						</span>
					</div>
					<p class="text-[10px] text-zinc-400 leading-relaxed">
						DanyAPI runs DeepSeek V4 and Qwen models inside Docker without requiring any host Python dependencies.
					</p>
				</div>
			</section>

			<!-- Section: Bun Orchestrator Architecture -->
			<section class="space-y-3">
				<div class="pb-2 border-b border-zinc-800/60 flex items-center gap-2">
					<Cpu class="w-4 h-4 text-cyan-400" />
					<h2 class="text-sm font-semibold text-zinc-100">Bun Orchestrator Runtime</h2>
				</div>

				<div class="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/70 space-y-3 font-mono text-[11px]">
					<div class="flex justify-between items-center py-1 border-b border-zinc-800/50">
						<span class="text-zinc-500">WebSocket Transport:</span>
						<span class="text-zinc-200">ws://127.0.0.1:4000/ws</span>
					</div>
					<div class="flex justify-between items-center py-1 border-b border-zinc-800/50">
						<span class="text-zinc-500">MCP JSON-RPC Endpoint:</span>
						<span class="text-zinc-200">http://127.0.0.1:4000/mcp</span>
					</div>
					<div class="flex justify-between items-center py-1 border-b border-zinc-800/50">
						<span class="text-zinc-500">SQLite Database:</span>
						<span class="text-zinc-200">orchestrator/data/conclave.db</span>
					</div>
					<div class="flex justify-between items-center py-1">
						<span class="text-zinc-500">ID Scheme:</span>
						<span class="text-zinc-200">Base58 Sortable IDs (Projects: 3, Tabs: 4)</span>
					</div>
				</div>
			</section>
		{/if}
	</div>
</div>
