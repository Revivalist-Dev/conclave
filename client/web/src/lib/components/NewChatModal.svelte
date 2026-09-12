<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import { Folder, X, CornerDownLeft, Sparkles } from 'lucide-svelte';

	let directoryInput = $state('');
	let selectedGroup = $state('Discussions');
	let inputEl = $state<HTMLInputElement>();

	$effect(() => {
		if (harness.showNewChatModal) {
			directoryInput = harness.lastProjectDirectory || '';
			selectedGroup = harness.pendingNewChatGroup || 'Discussions';
			// Delay focus slightly to ensure element is rendered
			setTimeout(() => {
				if (inputEl) {
					inputEl.focus();
					inputEl.select();
				}
			}, 50);
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (!harness.showNewChatModal) return;
		if (e.key === 'Escape') {
			close();
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function close() {
		harness.showNewChatModal = false;
	}

	function submit() {
		const dir = directoryInput.trim();
		harness.createConversation(
			selectedGroup,
			dir || undefined,
			harness.selectedLlmProvider || 'DeepSeek',
			harness.selectedLlmModel || 'Deepseek v4'
		);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if harness.showNewChatModal}
	<!-- Backdrop -->
	<button
		type="button"
		tabindex="-1"
		aria-label="Close modal"
		class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm cursor-default border-none p-0 animate-in fade-in duration-150"
		onclick={close}
	></button>

	<!-- Dialog Card -->
	<div
		class="fixed top-[25%] left-1/2 -translate-x-1/2 z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden select-none text-xs animate-in zoom-in-95 duration-150"
		role="dialog"
		aria-modal="true"
		aria-labelledby="new-chat-title"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/40">
			<div class="flex items-center gap-2">
				<div class="w-6 h-6 rounded-lg bg-cyan-950/80 border border-cyan-800/50 flex items-center justify-center text-cyan-400">
					<Sparkles class="w-3.5 h-3.5" />
				</div>
				<h2 id="new-chat-title" class="text-xs font-semibold text-zinc-100">
					Start New Chat
				</h2>
			</div>
			<button
				type="button"
				onclick={close}
				class="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
				title="Close (Esc)"
			>
				<X class="w-3.5 h-3.5" />
			</button>
		</div>

		<!-- Body -->
		<div class="p-4 space-y-4">
			<!-- Project Group Selector -->
			<div>
				<label class="block text-[11px] font-medium text-zinc-400 mb-1.5" for="project-group-select">
					Project Group
				</label>
				<div class="flex flex-wrap gap-1.5" id="project-group-select">
					{#each (harness.serverProjects.length > 0 ? harness.serverProjects.map((p) => p.name) : harness.projects) as proj}
						<button
							type="button"
							onclick={() => (selectedGroup = proj)}
							class="px-2.5 py-1 rounded-md text-[11px] border transition-all {selectedGroup === proj
								? 'bg-zinc-800 text-zinc-100 border-zinc-600 font-medium'
								: 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'}"
						>
							{proj}
						</button>
					{/each}
				</div>
			</div>

			<!-- Project Directory Input -->
			<div>
				<div class="flex items-center justify-between mb-1.5">
					<label class="text-[11px] font-medium text-zinc-300" for="project-dir-input">
						Project Directory
					</label>
					<span class="text-[10px] text-zinc-500">Optional · defaults to last</span>
				</div>

				<div class="relative flex items-center">
					<Folder class="w-3.5 h-3.5 text-zinc-500 absolute left-3 pointer-events-none" />
					<input
						id="project-dir-input"
						bind:this={inputEl}
						bind:value={directoryInput}
						type="text"
						placeholder="None (leave blank for no directory)"
						class="w-full bg-zinc-950 border border-zinc-800 focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/30 rounded-xl pl-9 pr-8 py-2 text-xs text-zinc-100 placeholder-zinc-600 outline-none transition-all font-mono"
					/>
					{#if directoryInput}
						<button
							type="button"
							onclick={() => (directoryInput = '')}
							class="absolute right-2.5 text-zinc-500 hover:text-zinc-300 p-0.5"
							title="Clear"
						>
							<X class="w-3 h-3" />
						</button>
					{/if}
				</div>
				<p class="text-[10px] text-zinc-500 mt-1.5 leading-relaxed">
					{#if directoryInput}
						Chat sessions in this conversation will target <span class="text-zinc-400 font-mono">{directoryInput}</span>.
					{:else}
						No directory attached. The chat will operate in general mode.
					{/if}
				</p>
			</div>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800/80 bg-zinc-950/40">
			<button
				type="button"
				onclick={close}
				class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={submit}
				class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-950 hover:bg-white active:scale-95 transition-all shadow-md"
			>
				<span>Start Chat</span>
				<CornerDownLeft class="w-3 h-3 text-zinc-600" />
			</button>
		</div>
	</div>
{/if}
