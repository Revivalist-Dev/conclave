<script lang="ts">
	import { harness } from '$lib/stores/harness.svelte';
	import { orchestratorSocket } from '$lib/services/orchestratorSocket.svelte';
	import { handleWindowDrag, handleShrinkWindow } from '$lib/utils/drag';
	import type { ModelInfo } from '$lib/types';
	import {
		ArrowLeft,
		SlidersHorizontal,
		Cpu,
		Server,
		Sparkles,
		Check,
		RefreshCw,
		ExternalLink,
		Layers,
		CheckCircle2,
		AlertCircle,
		Minimize2
	} from 'lucide-svelte';

	function selectModel(model: ModelInfo) {
		harness.selectedLlmModel = model.id;
		harness.selectedLlmProvider = model.provider;
		if (harness.activeConversation) {
			harness.activeConversation.model = model.id;
			harness.activeConversation.providerId = model.provider;
		}
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
	<title>Settings — brAInstorm</title>
</svelte:head>

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
		<div class="h-4 w-px bg-zinc-800"></div>
		<div class="flex items-center gap-2">
			<SlidersHorizontal class="w-4 h-4 text-cyan-400" />
			<h1 class="text-xs font-semibold text-zinc-200">Model Parameters & Settings</h1>
		</div>
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

<!-- Scrollable Settings Body -->
<div class="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-8 select-none text-xs text-zinc-300">
	<!-- Section 1: Active LLM Plugin Models -->
	<section class="space-y-3">
		<div class="flex items-center justify-between pb-2 border-b border-zinc-800/60">
			<div class="flex items-center gap-2">
				<Sparkles class="w-4 h-4 text-cyan-400" />
				<h2 class="text-sm font-semibold text-zinc-100">Available Models</h2>
				<span class="text-[10px] text-zinc-500 font-mono">({harness.availableModels.length} loaded from plugins)</span>
			</div>
			<span class="text-[11px] text-zinc-400 font-mono">
				Active: <strong class="text-zinc-200">{harness.selectedLlmModel || 'deepseek-v4-flash'}</strong>
			</span>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
			{#each harness.availableModels as model}
				{@const isSelected = (harness.selectedLlmModel || 'deepseek-v4-flash') === model.id}
				<button
					type="button"
					onclick={() => selectModel(model)}
					class="w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between {isSelected
						? 'bg-zinc-900/90 border-cyan-500/60 text-zinc-100 shadow-md ring-1 ring-cyan-500/20'
						: 'bg-zinc-900/40 border-zinc-800/70 text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200 hover:border-zinc-700'}"
				>
					<div class="flex items-start justify-between gap-2 w-full">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<span class="font-medium text-xs {isSelected ? 'text-white' : 'text-zinc-200'}">
									{model.name}
								</span>
								<span class="text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-tight {getProviderBadgeColor(model.provider)}">
									{model.provider}
								</span>
							</div>
							<div class="font-mono text-[10px] text-zinc-500 mt-0.5 truncate">
								id: {model.id}
							</div>
						</div>
						{#if isSelected}
							<div class="w-5 h-5 rounded-full bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 flex-shrink-0">
								<Check class="w-3 h-3" />
							</div>
						{/if}
					</div>
					{#if model.desc}
						<p class="text-[11px] text-zinc-400 mt-2 leading-relaxed">
							{model.desc}
						</p>
					{/if}
				</button>
			{/each}
		</div>
	</section>

	<!-- Section 2: Model Sampling Parameters -->
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

	<!-- Section 3: Engine Infrastructure & Local Containers -->
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

	<!-- Section 4: Bun Orchestrator Architecture -->
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
				<span class="text-zinc-200">orchestrator/data/brainstorm.db</span>
			</div>
			<div class="flex justify-between items-center py-1">
				<span class="text-zinc-500">ID Scheme:</span>
				<span class="text-zinc-200">Base58 Sortable IDs (Projects: 3, Tabs: 4)</span>
			</div>
		</div>
	</section>
</div>
