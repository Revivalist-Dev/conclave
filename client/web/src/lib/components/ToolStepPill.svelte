<script lang="ts">
	import type { ToolStep } from '../types';
	import {
		ChevronRight,
		CheckCircle2,
		Loader2,
		AlertCircle,
		Code2,
		GitBranch,
		FileSearch,
		Terminal,
		ExternalLink
	} from '@lucide/svelte';

	let { step }: { step: ToolStep } = $props();

	let expanded = $state(false);
</script>

<div class="my-2.5">
	<!-- Tool Action Pill Button -->
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800/80 border border-zinc-800 text-xs text-zinc-300 transition-all cursor-pointer group shadow-sm select-none"
	>
		<!-- Status/Tool Icon -->
		<div class="flex items-center text-zinc-400 group-hover:text-zinc-200">
			{#if step.status === 'running'}
				<Loader2 class="w-3.5 h-3.5 animate-spin text-zinc-400" />
			{:else if step.icon === 'linear'}
				<!-- Linear / Issue tracker icon -->
				<svg class="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 16 16" fill="currentColor">
					<path d="M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0zm5.2 2.7l4.5-4.5a.6.6 0 0 0-.8-.8L6.3 9.4 4.6 7.7a.6.6 0 0 0-.8.8l2.9 2.2z" />
				</svg>
			{:else if step.icon === 'git'}
				<GitBranch class="w-3.5 h-3.5 text-zinc-400" />
			{:else if step.icon === 'code'}
				<Code2 class="w-3.5 h-3.5 text-zinc-400" />
			{:else}
				<Terminal class="w-3.5 h-3.5 text-zinc-400" />
			{/if}
		</div>

		<!-- Step Name -->
		<span class="font-medium text-zinc-300 group-hover:text-zinc-100">
			{step.name}
		</span>

		<!-- Badge count e.g. [3], [4] -->
		{#if step.count !== undefined}
			<span class="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700/60">
				{step.count}
			</span>
		{/if}

		<!-- Expand arrow -->
		<ChevronRight
			class="w-3 h-3 text-zinc-500 transition-transform duration-150 {expanded ? 'rotate-90 text-zinc-300' : ''}"
		/>
	</button>

	<!-- Expandable Details Drawer -->
	{#if expanded && step.details && step.details.length > 0}
		<div
			class="mt-2 ml-2 pl-3 border-l border-zinc-800 space-y-2 max-w-2xl text-xs"
		>
			{#each step.details as detail}
				<div class="rounded-md bg-zinc-900/90 border border-zinc-800/80 p-2.5">
					<div class="flex items-center justify-between pb-1 mb-1 border-b border-zinc-800/60 text-zinc-400 text-[11px] font-mono">
						<span>{detail.title}</span>
						{#if detail.language}
							<span class="text-[10px] uppercase text-zinc-500">{detail.language}</span>
						{/if}
					</div>
					{#if detail.language === 'diff'}
						<pre class="font-mono text-[11px] leading-relaxed overflow-x-auto text-zinc-300 bg-zinc-950/60 p-2 rounded selectable-text">
							{#each detail.content.split('\n') as line}
								<div class={line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-rose-400' : 'text-zinc-400'}>{line}</div>
							{/each}
						</pre>
					{:else}
						<div class="font-mono text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed selectable-text">
							{detail.content}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
