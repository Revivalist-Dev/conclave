<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import { handleWindowDrag, handleShrinkWindow } from '../utils/drag';
	import { PanelLeftOpen, Minimize2 } from 'lucide-svelte';

	const activeConv = $derived(harness.activeConversation);

	const activeProjectName = $derived.by(() => {
		if (!activeConv) return 'Discussions';
		const proj = harness.serverProjects.find((p) => p.id === activeConv.project_id);
		return proj?.name || activeConv.group || 'Discussions';
	});
</script>

<header
	data-tauri-drag-region
	onmousedown={handleWindowDrag}
	class="h-12 flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/70 select-none flex-shrink-0 cursor-default transition-all {!harness.sidebarOpen ? 'pl-20 pr-4' : 'px-4'}"
>
	<!-- Left Side: Sidebar Toggle (if collapsed) & Project Name / Thread Name -->
	<div data-tauri-drag-region class="flex items-center gap-3 min-w-0 flex-1 h-full cursor-default">
		{#if !harness.sidebarOpen}
			<button
				type="button"
				onclick={() => harness.toggleSidebar()}
				class="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors flex-shrink-0 cursor-pointer"
				title="Expand Sidebar"
			>
				<PanelLeftOpen class="w-4 h-4" />
			</button>
		{/if}

		{#if activeConv}
			<div data-tauri-drag-region class="flex items-center gap-1.5 min-w-0 pointer-events-none">
				<span class="text-xs font-medium text-zinc-400 truncate max-w-[130px] leading-tight">
					{activeProjectName}
				</span>
				<span class="text-zinc-600 select-none text-xs font-mono">/</span>
				<h1 class="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[200px] leading-tight">
					{activeConv.title}
				</h1>
			</div>
		{/if}
	</div>

	<!-- Right Side: Shrink Window Button (Minimize2) -->
	<div class="flex items-center gap-2 flex-shrink-0">
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
