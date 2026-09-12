<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import { handleWindowDrag } from '../utils/drag';
	import { adjustHudSize, isTauriEnvironment } from '../services/windowManager';
	import { marked } from 'marked';
	import {
		Maximize2,
		X,
		ArrowUp,
		Copy,
		Check,
		Sparkles,
		ExternalLink,
		GripVertical,
		ChevronRight,
		Bell
	} from 'lucide-svelte';

	// View modes: 'idle' | 'prompt' | 'generating' | 'alert_preview' | 'full_content'
	type ViewMode = 'idle' | 'prompt' | 'generating' | 'alert_preview' | 'full_content';
	let currentView = $state<ViewMode>('idle');

	let promptText = $state('');
	let followUpText = $state('');
	let textareaEl = $state<HTMLTextAreaElement>();
	let responseContainer = $state<HTMLDivElement>();

	// 15-second preview auto-hide state
	let previewCountdown = $state(15);
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let isPreviewHovered = $state(false);
	let copied = $state(false);

	// Derived state from harness
	const activeConv = $derived(harness.activeConversation);
	const isGenerating = $derived(harness.isGenerating);
	const lastMessage = $derived.by(() => {
		if (!activeConv || activeConv.messages.length === 0) return null;
		return activeConv.messages[activeConv.messages.length - 1];
	});

	// Track generation transitions to trigger the 15s alert preview
	let prevGenerating = $state(false);

	$effect(() => {
		const generating = isGenerating;
		if (generating) {
			// When generating starts while idle, prompt, or alert, transition to generating
			if (currentView !== 'full_content') {
				currentView = 'generating';
				clearCountdown();
			}
		} else if (prevGenerating && !generating) {
			// Generation just finished!
			// If not already in full_content mode, trigger the 15s response alert preview
			if (currentView !== 'full_content') {
				triggerResponseAlert();
			}
		}
		prevGenerating = generating;
	});

	// Dynamic window sizing based on current view mode in Tauri
	$effect(() => {
		if (isTauriEnvironment()) {
			switch (currentView) {
				case 'full_content':
					adjustHudSize(560, 420);
					break;
				case 'alert_preview':
					adjustHudSize(440, 138);
					break;
				case 'prompt':
					adjustHudSize(480, 185);
					break;
				case 'generating':
					adjustHudSize(440, 110);
					break;
				case 'idle':
				default:
					adjustHudSize(250, 70);
					break;
			}
		}
	});

	// Auto-scroll response container when new tokens stream in
	$effect(() => {
		if (lastMessage?.content && responseContainer && currentView === 'full_content') {
			responseContainer.scrollTop = responseContainer.scrollHeight;
		}
	});

	function triggerResponseAlert() {
		clearCountdown();
		currentView = 'alert_preview';
		previewCountdown = 15;
		countdownTimer = setInterval(() => {
			if (!isPreviewHovered) {
				previewCountdown -= 1;
				if (previewCountdown <= 0) {
					clearCountdown();
					currentView = 'idle';
				}
			}
		}, 1000);
	}

	function clearCountdown() {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
	}

	function openFullContent() {
		clearCountdown();
		currentView = 'full_content';
	}

	function toggleBrain() {
		if (currentView === 'alert_preview') {
			// Clicking brain while alert preview is active opens the full content
			openFullContent();
		} else if (currentView === 'full_content') {
			// Dismiss back to idle
			currentView = 'idle';
		} else if (currentView === 'prompt') {
			currentView = 'idle';
		} else if (currentView === 'generating') {
			// View full streaming content
			openFullContent();
		} else {
			// Open prompt
			currentView = 'prompt';
			setTimeout(() => {
				if (textareaEl) textareaEl.focus();
			}, 60);
		}
	}

	function handlePromptKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			currentView = 'idle';
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitPrompt();
		}
	}

	function submitPrompt() {
		const text = promptText.trim();
		if (!text || isGenerating) return;

		promptText = '';
		currentView = 'generating';
		clearCountdown();
		harness.sendMessage(text);
	}

	function submitFollowUp() {
		const text = followUpText.trim();
		if (!text || isGenerating) return;

		followUpText = '';
		harness.sendMessage(text);
	}

	async function copyResponse() {
		if (!lastMessage?.content) return;
		try {
			await navigator.clipboard.writeText(lastMessage.content);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {}
	}

	function getPreviewSnippet(content?: string, maxLen = 140): string {
		if (!content) return 'Response completed.';
		const plain = content
			.replace(/```[\s\S]*?```/g, '[Code]')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/[#*_~>]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (plain.length <= maxLen) return plain;
		return plain.slice(0, maxLen).trim() + '...';
	}

	function renderMarkdown(content: string): string {
		if (!content) return '';
		try {
			return marked.parse(content, { gfm: true, breaks: true }) as string;
		} catch {
			return content;
		}
	}
</script>

<div
	role="region"
	aria-label="Minimalist HUD Overlay"
	class="w-full h-full bg-transparent select-none overflow-hidden relative flex flex-col justify-start p-1.5 transition-all"
>
	<!-- Top Row: Floating Brain Button + Draggable Accessory Bar / Preview -->
	<div class="flex items-center gap-2 w-full flex-shrink-0">
		<!-- Brain Icon Button: Pinned to Left -->
		<div
			role="toolbar"
			tabindex="0"
			data-tauri-drag-region
			onmousedown={handleWindowDrag}
			class="relative flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-900/90 border border-white/10 shadow-2xl backdrop-blur-xl group hover:border-cyan-500/40 transition-all cursor-default flex-shrink-0"
		>
			<!-- Brain Action Button -->
			<button
				type="button"
				onclick={toggleBrain}
				class="relative w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center bg-zinc-950 border border-zinc-700/80 hover:border-cyan-400 active:scale-95 transition-all shadow-inner cursor-pointer {currentView ===
				'alert_preview'
					? 'ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.6)]'
					: ''}"
				title={currentView === 'alert_preview'
					? 'New response ready — Click to open full contents'
					: currentView === 'full_content'
						? 'Click to collapse HUD'
						: currentView === 'prompt'
							? 'Click to close prompt'
							: 'brAInstorm — Click to open prompt HUD'}
			>
				<img
					src="/brainstorm-app-icon.png"
					alt="brAInstorm"
					class="w-full h-full object-cover select-none pointer-events-none {isGenerating
						? 'animate-pulse scale-105'
						: ''}"
				/>

				<!-- Status / Alert Glow Dot -->
				{#if currentView === 'alert_preview'}
					<!-- Active Response Alert Pulse -->
					<span class="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
					<span class="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 border border-black"></span>
				{:else if isGenerating}
					<span class="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
				{:else}
					<span class="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400 border border-black"></span>
				{/if}
			</button>

			<!-- Restore Full Desktop Chat Window -->
			<button
				type="button"
				onclick={() => harness.exitMinimalistMode()}
				class="p-1.5 rounded-lg text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800 transition-colors cursor-pointer"
				title="Restore full chat window"
			>
				<Maximize2 class="w-3.5 h-3.5" />
			</button>
		</div>

		<!-- Idle Draggable HUD Pill -->
		{#if currentView === 'idle'}
			<div
				role="toolbar"
				tabindex="0"
				data-tauri-drag-region
				onmousedown={handleWindowDrag}
				class="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/80 border border-white/10 backdrop-blur-md text-[11px] text-zinc-400 cursor-grab active:cursor-grabbing shadow-lg"
			>
				<GripVertical class="w-3.5 h-3.5 text-zinc-600" />
				<span class="font-medium text-zinc-300">{harness.selectedLlmModel || 'Deepseek v4'}</span>
				<span class="text-zinc-600 font-mono text-[9px] uppercase">HUD</span>
			</div>
		{/if}

		<!-- Generating / Thinking Indicator Pill -->
		{#if currentView === 'generating'}
			<div
				role="button"
				tabindex="0"
				data-tauri-drag-region
				onmousedown={handleWindowDrag}
				onclick={openFullContent}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						openFullContent();
					}
				}}
				class="flex-1 flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-900/90 border border-cyan-500/30 backdrop-blur-md text-[11px] text-zinc-300 shadow-lg cursor-pointer hover:border-cyan-400/60 transition-all"
				title="Click to view live stream"
			>
				<div class="flex items-center gap-2 min-w-0">
					<span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
					<span class="truncate font-medium text-cyan-200">Generating response...</span>
				</div>
				<span class="text-zinc-500 text-[10px] font-mono">Stream →</span>
			</div>
		{/if}

		<!-- 15-Second Response Alert Preview Card (Inline Top / Overlay) -->
		{#if currentView === 'alert_preview'}
			<div
				role="button"
				tabindex="0"
				onmouseenter={() => (isPreviewHovered = true)}
				onmouseleave={() => (isPreviewHovered = false)}
				onclick={openFullContent}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						openFullContent();
					}
				}}
				class="flex-1 flex flex-col rounded-2xl bg-zinc-900/95 border border-amber-500/40 shadow-2xl backdrop-blur-2xl overflow-hidden cursor-pointer hover:border-amber-400 transition-all animate-in fade-in zoom-in-95 duration-150 group text-left"
				title="Click to open full contents over HUD"
			>
				<!-- Alert Header -->
				<div class="flex items-center justify-between px-2.5 pt-2 pb-1 text-[11px]">
					<div class="flex items-center gap-1.5 min-w-0">
						<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
						<span class="font-medium text-amber-300 text-[11px] flex items-center gap-1">
							<Sparkles class="w-3 h-3 text-amber-400" />
							Response ready
						</span>
						<span class="text-zinc-600">·</span>
						<span class="font-mono text-zinc-400 text-[10px] truncate max-w-[120px]">
							{lastMessage?.model || harness.selectedLlmModel || 'Deepseek v4'}
						</span>
					</div>

					<div class="flex items-center gap-1">
						<!-- Countdown Pill -->
						<span
							class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 border border-white/10 {isPreviewHovered
								? 'text-amber-300 border-amber-500/40'
								: 'text-zinc-300'}"
							title={isPreviewHovered ? 'Paused on hover' : `Auto-hides in ${previewCountdown}s`}
						>
							{isPreviewHovered ? 'Paused' : `${previewCountdown}s`}
						</span>

						<!-- Dismiss Button -->
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								clearCountdown();
								currentView = 'idle';
							}}
							class="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
							title="Dismiss preview (Esc)"
						>
							<X class="w-3 h-3" />
						</button>
					</div>
				</div>

				<!-- Preview Snippet -->
				<div class="px-2.5 py-1 text-xs text-zinc-200 line-clamp-2 leading-relaxed">
					{getPreviewSnippet(lastMessage?.content)}
				</div>

				<!-- Action hint -->
				<div class="px-2.5 pb-1.5 pt-0.5 flex items-center justify-between text-[10px] text-cyan-400">
					<span class="group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
						Click to open over HUD <ChevronRight class="w-3 h-3 inline" />
					</span>
					{#if lastMessage?.totalTokens}
						<span class="text-zinc-500 font-mono text-[9px]">{lastMessage.totalTokens} tokens</span>
					{/if}
				</div>

				<!-- 15-second animated progress countdown bar -->
				<div class="w-full h-1 bg-zinc-800/80 overflow-hidden flex-shrink-0">
					<div
						class="h-full bg-amber-400 transition-all duration-1000 ease-linear"
						style="width: {(previewCountdown / 15) * 100}%"
					></div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Prompt Box: Over Transparent Area -->
	{#if currentView === 'prompt'}
		<div
			class="mt-2 w-full flex-1 flex flex-col rounded-2xl bg-zinc-900/95 border border-white/15 shadow-2xl backdrop-blur-2xl p-3 animate-in fade-in zoom-in-95 duration-150"
		>
			<!-- Prompt Header -->
			<div class="flex items-center justify-between pb-2 border-b border-white/10 text-[11px] text-zinc-400">
				<div class="flex items-center gap-1.5">
					<Sparkles class="w-3 h-3 text-cyan-400" />
					<span class="font-mono text-zinc-300 text-[10px]">{harness.selectedLlmModel || 'Deepseek v4'}</span>
					<span class="text-zinc-600">·</span>
					<span class="text-zinc-400">Discussions</span>
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={() => harness.exitMinimalistMode()}
						class="text-zinc-500 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors"
						title="Open in full window"
					>
						<ExternalLink class="w-3 h-3" />
					</button>
					<button
						type="button"
						onclick={() => (currentView = 'idle')}
						class="text-zinc-500 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors"
						title="Close prompt (Esc)"
					>
						<X class="w-3 h-3" />
					</button>
				</div>
			</div>

			<!-- Input Textarea -->
			<div class="pt-2 flex-1 flex items-start gap-2">
				<textarea
					bind:this={textareaEl}
					bind:value={promptText}
					onkeydown={handlePromptKeydown}
					placeholder="Ask anything... (↵ send, esc hide)"
					rows={2}
					class="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 resize-none outline-none leading-relaxed"
				></textarea>

				<button
					type="button"
					onclick={submitPrompt}
					disabled={!promptText.trim()}
					class="p-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-zinc-950 font-bold transition-all shadow-md active:scale-95 cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
					title="Send prompt (Enter)"
				>
					<ArrowUp class="w-3.5 h-3.5 stroke-[2.5]" />
				</button>
			</div>
		</div>
	{/if}

	<!-- Full Contents Over Transparent HUD (Open on Click) -->
	{#if currentView === 'full_content'}
		<div
			class="mt-2 w-full flex-1 flex flex-col rounded-2xl bg-zinc-900/95 border border-white/15 shadow-2xl backdrop-blur-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
		>
			<!-- Full Response Header & Drag Region -->
			<div
				role="toolbar"
				tabindex="0"
				data-tauri-drag-region
				onmousedown={handleWindowDrag}
				class="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-zinc-950/60 text-[11px] select-none cursor-grab active:cursor-grabbing flex-shrink-0"
			>
				<div class="flex items-center gap-1.5 min-w-0">
					<span class="w-2 h-2 rounded-full {isGenerating ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}"></span>
					<span class="font-mono text-zinc-200 text-[10px] truncate max-w-[150px]">
						{lastMessage?.model || harness.selectedLlmModel || 'Deepseek v4'}
					</span>
					{#if lastMessage?.totalTokens}
						<span class="text-zinc-600">·</span>
						<span class="text-zinc-400 font-mono text-[9px]">{lastMessage.totalTokens} tok</span>
					{/if}
				</div>

				<!-- Controls: Copy, Open Full Chat Window, Close -->
				<div class="flex items-center gap-1">
					{#if !isGenerating}
						<button
							type="button"
							onclick={copyResponse}
							class="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
							title={copied ? 'Copied!' : 'Copy response'}
						>
							{#if copied}
								<Check class="w-3 h-3 text-emerald-400" />
							{:else}
								<Copy class="w-3 h-3" />
							{/if}
						</button>
					{/if}

					<button
						type="button"
						onclick={() => harness.exitMinimalistMode()}
						class="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
						title="Open full conversation window"
					>
						<ExternalLink class="w-3 h-3" />
					</button>

					<button
						type="button"
						onclick={() => (currentView = 'idle')}
						class="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
						title="Dismiss HUD (Esc)"
					>
						<X class="w-3 h-3" />
					</button>
				</div>
			</div>

			<!-- Response Body Container -->
			<div
				bind:this={responseContainer}
				class="flex-1 overflow-y-auto p-3 text-xs leading-relaxed text-zinc-200 select-text font-normal space-y-2 prose-invert"
			>
				{#if isGenerating && (!lastMessage || !lastMessage.content)}
					<div class="flex items-center gap-2 text-zinc-400 py-3">
						<span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
						<span class="italic text-[11px]">Thinking & generating response...</span>
					</div>
				{:else if lastMessage?.content}
					<div class="break-words font-sans text-zinc-200">
						{@html renderMarkdown(lastMessage.content)}
					</div>
				{/if}
			</div>

			<!-- Follow-up Prompt Input Bar (Over HUD) -->
			<div class="p-2 border-t border-white/10 bg-zinc-950/40 flex items-center gap-2 flex-shrink-0">
				<input
					type="text"
					bind:value={followUpText}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							submitFollowUp();
						}
					}}
					placeholder="Reply... (↵ send)"
					class="flex-1 bg-zinc-900/90 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-cyan-500/50"
				/>
				<button
					type="button"
					onclick={submitFollowUp}
					disabled={!followUpText.trim() || isGenerating}
					class="p-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 text-zinc-950 font-bold transition-all shadow-md active:scale-95 cursor-pointer disabled:cursor-not-allowed"
					title="Send reply"
				>
					<ArrowUp class="w-3.5 h-3.5 stroke-[2.5]" />
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.prose-invert pre) {
		background: rgba(0, 0, 0, 0.4);
		padding: 0.5rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.1);
		overflow-x: auto;
		font-size: 0.75rem;
	}
	:global(.prose-invert code) {
		font-family: ui-monospace, monospace;
		background: rgba(255, 255, 255, 0.08);
		padding: 0.1rem 0.25rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
	}
	:global(.prose-invert p) {
		margin-bottom: 0.5rem;
	}
	:global(.prose-invert p:last-child) {
		margin-bottom: 0;
	}
</style>

