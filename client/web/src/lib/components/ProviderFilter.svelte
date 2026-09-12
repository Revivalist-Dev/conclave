<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import { Check, ChevronDown, ListFilter, Server } from 'lucide-svelte';

	let { variant = 'icon' }: { variant?: 'icon' | 'full' } = $props();

	let open = $state(false);

	const activeProviderObj = $derived.by(() => {
		if (harness.providerFilter === 'all') return null;
		return harness.providers.find((p) => p.id === harness.providerFilter) || null;
	});

	function selectFilter(id: string) {
		harness.setProviderFilter(id);
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative">
	{#if variant === 'icon'}
		<!-- Filter Icon matching screenshot placement -->
		<button
			type="button"
			onclick={() => (open = !open)}
			class="p-1.5 rounded-md transition-colors relative flex items-center justify-center {harness.providerFilter !== 'all'
				? 'text-zinc-100 bg-zinc-800/80 border border-zinc-700/60'
				: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'}"
			title="Filter by Provider ({activeProviderObj ? activeProviderObj.name : 'All Providers'})"
		>
			<ListFilter class="w-4 h-4" />
			{#if activeProviderObj}
				<span
					class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full {activeProviderObj.status === 'online'
						? 'bg-emerald-500'
						: 'bg-zinc-400'}"
				></span>
			{/if}
		</button>
	{:else}
		<!-- Full Pill Trigger Button -->
		<button
			type="button"
			onclick={() => (open = !open)}
			class="flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border transition-colors {harness.providerFilter !== 'all'
				? 'bg-zinc-800/90 text-zinc-100 border-zinc-700'
				: 'bg-zinc-900/50 text-zinc-400 border-zinc-800/80 hover:bg-zinc-800/60 hover:text-zinc-200'}"
			title="Filter conversations by provider"
		>
			<ListFilter class="w-3 h-3 text-zinc-400" />
			<span class="truncate max-w-[90px]">
				{activeProviderObj ? activeProviderObj.name : 'All Providers'}
			</span>
			{#if activeProviderObj}
				<span
					class="w-1.5 h-1.5 rounded-full {activeProviderObj.status === 'online'
						? 'bg-emerald-500'
						: 'bg-zinc-500'}"
				></span>
			{/if}
			<ChevronDown class="w-2.5 h-2.5 text-zinc-500 transition-transform {open ? 'rotate-180' : ''}" />
		</button>
	{/if}

	<!-- Dropdown menu -->
	{#if open}
		<!-- Backdrop click handler -->
		<button
			type="button"
			tabindex="-1"
			aria-label="Close provider filter menu"
			class="fixed inset-0 z-40 bg-transparent cursor-default border-none p-0"
			onclick={() => (open = false)}
		></button>

		<div
			class="absolute right-0 mt-1.5 w-56 z-50 rounded-lg bg-zinc-900 border border-zinc-800 shadow-2xl p-1 text-xs"
		>
			<div class="px-2 py-1 text-[10px] uppercase font-semibold tracking-wider text-zinc-500">
				Filter by Provider
			</div>

			<!-- Option: All Providers -->
			<button
				type="button"
				onclick={() => selectFilter('all')}
				class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors {harness.providerFilter ===
				'all'
					? 'bg-zinc-800 text-zinc-100'
					: 'text-zinc-300 hover:bg-zinc-800/60'}"
			>
				<div class="flex items-center gap-2">
					<Server class="w-3.5 h-3.5 text-zinc-400" />
					<span>All Providers</span>
				</div>
				{#if harness.providerFilter === 'all'}
					<Check class="w-3 h-3 text-zinc-300" />
				{/if}
			</button>

			<div class="my-1 border-t border-zinc-800/80"></div>

			<!-- Registered providers list -->
			{#each harness.providers as provider}
				<button
					type="button"
					onclick={() => selectFilter(provider.id)}
					class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left transition-colors {harness.providerFilter ===
					provider.id
						? 'bg-zinc-800 text-zinc-100'
						: 'text-zinc-300 hover:bg-zinc-800/60'}"
				>
					<div class="flex items-center gap-2 min-w-0">
						<span
							class="w-1.5 h-1.5 rounded-full flex-shrink-0 {provider.status === 'online'
								? 'bg-emerald-500'
								: 'bg-zinc-600'}"
						></span>
						<span class="truncate">{provider.name}</span>
						{#if provider.isLocal}
							<span class="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
								local
							</span>
						{/if}
					</div>
					<div class="flex items-center gap-1.5">
						{#if provider.latency}
							<span class="text-[10px] text-zinc-500">{provider.latency}ms</span>
						{/if}
						{#if harness.providerFilter === provider.id}
							<Check class="w-3 h-3 text-zinc-300" />
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
