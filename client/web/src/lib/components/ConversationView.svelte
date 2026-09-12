<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import ToolStepPill from './ToolStepPill.svelte';
	import { Bot, FileText, Image as ImageIcon } from 'lucide-svelte';
	import { marked } from 'marked';
	import hljs from 'highlight.js';
	import 'highlight.js/styles/github-dark.css';

	marked.setOptions({
		gfm: true,
		breaks: true
	});

	marked.use({
		renderer: {
			code({ text, lang }: { text: string; lang?: string }) {
				const rawLang = (lang || '').trim().split(/\s+/)[0].toLowerCase();
				const validLang = rawLang && hljs.getLanguage(rawLang) ? rawLang : '';
				let highlighted = '';

				try {
					if (validLang) {
						highlighted = hljs.highlight(text, { language: validLang }).value;
					} else {
						highlighted = hljs.highlightAuto(text).value;
					}
				} catch {
					highlighted = escapeHtml(text);
				}

				const displayLang = validLang || rawLang || 'code';
				const lines = text.split('\n');
				const isCollapsible = lines.length > 15;

				let bodyHtml = `<pre class="p-3.5 m-0 overflow-x-auto text-[11.5px] leading-relaxed font-mono bg-zinc-950 text-zinc-200"><code class="hljs ${validLang ? `language-${validLang}` : ''}">${highlighted}</code></pre>`;

				if (isCollapsible) {
					bodyHtml = `<div class="code-block-content relative overflow-hidden" data-collapsed="true" style="max-height: 280px;">
						${bodyHtml}
						<div class="code-collapse-overlay absolute bottom-0 inset-x-0 h-16 pointer-events-none"></div>
					</div>
					<div class="code-collapse-bar flex items-center justify-center py-1.5 bg-zinc-900/90 hover:bg-zinc-900 border-t border-zinc-800 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer select-none transition-colors">
						<button type="button" class="toggle-code-btn flex items-center gap-1 cursor-pointer bg-transparent border-0 text-inherit p-0" data-total-lines="${lines.length}">
							<span>Show all (${lines.length} lines) ▾</span>
						</button>
					</div>`;
				}

				return `<div class="code-block-wrapper my-3 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-lg select-text">
					<div class="code-block-header flex items-center justify-between px-3.5 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-[11px] font-mono text-zinc-400 select-none">
						<div class="flex items-center gap-2">
							<span class="w-2 h-2 rounded-full bg-emerald-500/70"></span>
							<span class="text-zinc-300 font-medium tracking-wide lowercase">${escapeHtml(displayLang)}</span>
						</div>
						<button type="button" class="copy-code-btn flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors text-[10px] cursor-pointer" data-code="${encodeURIComponent(text)}" title="Copy code">
							<svg class="w-3 h-3 copy-icon flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
							<span class="copy-label">Copy</span>
						</button>
					</div>
					${bodyHtml}
				</div>`;
			}
		}
	});

	let messagesContainer = $state<HTMLDivElement>();
	let lastMsgCount = 0;
	let expandedUserMessages = $state<Record<string, boolean>>({});

	const activeConv = $derived(harness.activeConversation);
	const activeProjectName = $derived.by(() => {
		if (!activeConv) return 'Discussions';
		const proj = harness.serverProjects.find((p) => p.id === activeConv.project_id);
		return proj?.name || activeConv.group || 'Discussions';
	});

	function formatBytes(bytes: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	function handleContainerClick(e: MouseEvent) {
		// 1. Toggle collapsible code block
		const toggleBtn = (e.target as HTMLElement).closest('.toggle-code-btn, .code-collapse-bar') as HTMLElement | null;
		if (toggleBtn) {
			e.preventDefault();
			e.stopPropagation();
			const wrapper = toggleBtn.closest('.code-block-wrapper');
			if (wrapper) {
				const content = wrapper.querySelector('.code-block-content') as HTMLElement | null;
				const overlay = wrapper.querySelector('.code-collapse-overlay') as HTMLElement | null;
				const btn = wrapper.querySelector('.toggle-code-btn') as HTMLElement | null;
				if (content && btn) {
					const isCollapsed = content.getAttribute('data-collapsed') === 'true';
					const totalLines = btn.getAttribute('data-total-lines') || '';
					if (isCollapsed) {
						content.setAttribute('data-collapsed', 'false');
						content.style.maxHeight = 'none';
						if (overlay) overlay.style.display = 'none';
						btn.innerHTML = `<span>Show less ▴</span>`;
					} else {
						content.setAttribute('data-collapsed', 'true');
						content.style.maxHeight = '280px';
						if (overlay) overlay.style.display = 'block';
						btn.innerHTML = `<span>Show all (${totalLines} lines) ▾</span>`;
					}
				}
			}
			return;
		}

		// 2. Copy code button
		const btn = (e.target as HTMLElement).closest('.copy-code-btn') as HTMLButtonElement | null;
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();

		const encoded = btn.getAttribute('data-code');
		if (!encoded) return;

		try {
			const text = decodeURIComponent(encoded);
			navigator.clipboard.writeText(text).then(() => {
				const label = btn.querySelector('.copy-label');
				if (label) label.textContent = 'Copied!';
				btn.classList.add('text-emerald-400');
				setTimeout(() => {
					if (label) label.textContent = 'Copy';
					btn.classList.remove('text-emerald-400');
				}, 2000);
			});
		} catch (err) {
			console.warn('Failed to copy code:', err);
		}
	}

	function getModelName(modelId?: string): string {
		if (!modelId) return harness.availableModels[0]?.name || 'Deepseek v4';
		const found = harness.availableModels.find((m) => m.id === modelId);
		return found ? found.name : modelId;
	}

	function renderMarkdown(content: string): string {
		if (!content) return '';

		// Handle DeepSeek <think> ... </think> reasoning tags
		let processed = content;
		const thinkMatch = processed.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
		let thinkHtml = '';
		if (thinkMatch) {
			const thinkContent = thinkMatch[1].trim();
			if (thinkContent) {
				thinkHtml = `<details class="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/60 text-xs overflow-hidden" open>
					<summary class="flex items-center gap-1.5 px-3 py-2 cursor-pointer text-zinc-400 hover:text-zinc-200 select-none font-medium bg-zinc-900/90 border-b border-zinc-800/40">
						<span class="text-cyan-400">🧠</span>
						<span>Reasoning Process</span>
					</summary>
					<div class="p-3 text-zinc-400 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border-t border-zinc-800/30">
						${escapeHtml(thinkContent)}
					</div>
				</details>`;
			}
			processed = processed.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
		}

		const bodyHtml = processed ? (marked.parse(processed) as string) : '';
		return thinkHtml + bodyHtml;
	}

	$effect(() => {
		const currentCount = activeConv?.messages.length || 0;
		if (!messagesContainer || currentCount === 0) return;

		if (currentCount !== lastMsgCount) {
			lastMsgCount = currentCount;
			const lastMsg = activeConv?.messages[currentCount - 1];

			if (lastMsg?.role === 'user') {
				// Question added: center it smoothly so it scrolls up comfortably from the bottom
				setTimeout(() => {
					if (!messagesContainer) return;
					const userNodes = messagesContainer.querySelectorAll('.user-message-row');
					const lastUserNode = userNodes[userNodes.length - 1];
					if (lastUserNode) {
						lastUserNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
					}
				}, 60);
			} else {
				// Assistant message added
				setTimeout(() => {
					if (!messagesContainer) return;
					messagesContainer.scrollTo({
						top: messagesContainer.scrollHeight,
						behavior: 'smooth'
					});
				}, 60);
			}
		} else {
			// Streaming tokens within existing assistant message
			const distanceFromBottom =
				messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
			if (distanceFromBottom < 200) {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			}
		}
	});
</script>

<div
	bind:this={messagesContainer}
	onclick={handleContainerClick}
	role="region"
	aria-label="Conversation messages"
	class="flex-1 overflow-y-auto px-8 pt-3 pb-3 select-none"
>
	{#if !activeConv || activeConv.messages.length === 0}
		<!-- Empty state -->
		<div class="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-16">
			<div class="w-10 h-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
				<Bot class="w-5 h-5 text-zinc-400" />
			</div>
			<p class="text-xs font-medium text-zinc-300">Ready for prompt</p>
			<p class="text-[11px] text-zinc-500 mt-1 max-w-sm">
				Select a provider or ask anything. Local LLM engines can stream content and run tools directly into this harness.
			</p>
		</div>
	{:else}
		<!-- Tab & Project metadata bar + Sort order toggle -->
		<div class="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/40 text-[11px] text-zinc-500 select-none">
			<span class="font-mono text-[10px] tracking-tight flex items-center gap-1.5">
				<span class="text-zinc-300 font-medium">{activeProjectName}</span>
				<span class="text-zinc-600">/</span>
				<span class="text-zinc-300">{activeConv.title}</span>
				<span class="text-zinc-600">•</span>
				<span>{activeConv.messages.length} msgs</span>
			</span>
			<button
				type="button"
				onclick={() => harness.toggleMessageSortOrder()}
				class="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800/80 text-[10px] cursor-pointer transition-colors"
				title="Toggle message sort order (newest to oldest / oldest to newest)"
			>
				<span class="text-zinc-500">Sort:</span>
				<span class="text-zinc-200 font-medium">{harness.messageSortOrder === 'desc' ? 'Newest first ↓' : 'Oldest first ↑'}</span>
			</button>
		</div>

		{#each harness.displayedMessages as message, i (message.id)}
			{#if message.role === 'user'}
				{@const isLong = message.content.length > 280 || message.content.split('\n').length > 4}
				{@const isExpanded = !!expandedUserMessages[message.id]}
				<!-- User Message: Compact right-aligned dark bubble with attachment preview -->
				<div class="flex flex-col items-end user-message-row space-y-1.5" style={i > 0 ? "margin-top: 16px;" : "margin-top: 2px;"}>
					{#if message.attachments && message.attachments.length > 0}
						<div class="flex flex-wrap gap-1.5 justify-end max-w-[85%]">
							{#each message.attachments as att}
								<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700/70 text-xs text-zinc-200 shadow-sm">
									{#if att.mimeType?.startsWith('image/')}
										<ImageIcon class="w-3 h-3 text-cyan-400 flex-shrink-0" />
									{:else}
										<FileText class="w-3 h-3 text-cyan-400 flex-shrink-0" />
									{/if}
									<span class="font-medium truncate max-w-[180px] text-[11px]" title={att.name}>{att.name}</span>
									{#if att.size}
										<span class="text-[9px] text-zinc-400 font-mono">({formatBytes(att.size)})</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
					<div
						class="max-w-[80%] rounded-2xl bg-zinc-800/90 text-zinc-200 border border-zinc-700/60 px-4 py-2 text-xs leading-relaxed shadow-sm selectable-text"
					>
						<div class={isLong && !isExpanded ? 'line-clamp-4 whitespace-pre-wrap' : 'whitespace-pre-wrap'}>
							{message.content}
						</div>
						{#if isLong}
							<button
								type="button"
								onclick={() => (expandedUserMessages[message.id] = !isExpanded)}
								class="mt-1 text-cyan-400 hover:text-cyan-300 font-medium text-[11px] flex items-center gap-0.5 select-none transition-colors cursor-pointer"
							>
								{isExpanded ? 'Show less ▴' : '... Show more ▾'}
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<!-- Assistant Message: Left-aligned with tool action badges, 18px closer to user comment -->
				<div class="flex flex-col space-y-1 max-w-3xl assistant-message-row" style="margin-top: 6px;">
					<!-- Tool Steps matching mockup (if real tool steps exist) -->
					{#if message.toolSteps && message.toolSteps.length > 0}
						<div class="flex flex-col items-start">
							{#each message.toolSteps as step}
								<ToolStepPill {step} />
							{/each}
						</div>
					{/if}

					<!-- Assistant Text Content -->
					{#if message.content}
						<div
							class="text-xs leading-relaxed text-zinc-300 font-normal selectable-text space-y-1.5 markdown-body"
						>
							{@html renderMarkdown(message.content)}
						</div>

						<!-- Usage display: moved 10px higher with style="margin-top: -7px;" -->
						{#if (message.totalTokens ?? message.usage?.totalTokens) !== undefined}
							<div class="flex justify-end select-none" style="margin-top: -7px;">
								<span class="text-[10px] text-zinc-500 font-mono tracking-tight hover:text-zinc-400 transition-colors leading-none">
									{getModelName(message.model || activeConv?.model || harness.selectedLlmModel)} tokens used: {message.totalTokens ?? message.usage?.totalTokens}
								</span>
							</div>
						{/if}
					{:else if harness.isGenerating}
						<!-- Animated three dots typing indicator -->
						<div class="flex items-center gap-1.5 py-1 px-2 text-zinc-400">
							<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]"></span>
							<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]"></span>
							<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce"></span>
						</div>
					{/if}
				</div>
			{/if}
		{/each}

		<!-- If generating and assistant message has not been appended yet -->
		{#if harness.isGenerating && activeConv.messages.length > 0 && activeConv.messages[activeConv.messages.length - 1].role === 'user'}
			<div class="flex flex-col space-y-1 max-w-3xl assistant-message-row" style="margin-top: 6px;">
				<div class="flex items-center gap-1.5 py-1 px-2 text-zinc-400">
					<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]"></span>
					<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]"></span>
					<span class="inline-block w-2 h-2 rounded-full bg-zinc-400 animate-bounce"></span>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	:global(.markdown-body) {
		color: #d4d4d8;
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	:global(.markdown-body p) {
		margin-bottom: 0.5rem;
	}
	:global(.markdown-body > *:last-child),
	:global(.markdown-body p:last-child) {
		margin-bottom: 0 !important;
	}
	:global(.markdown-body h1) {
		font-size: 1.15rem;
		font-weight: 700;
		color: #f4f4f5;
		margin-top: 1.25rem;
		margin-bottom: 0.5rem;
	}
	:global(.markdown-body h2) {
		font-size: 1rem;
		font-weight: 600;
		color: #f4f4f5;
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}
	:global(.markdown-body h3) {
		font-size: 0.875rem;
		font-weight: 600;
		color: #f4f4f5;
		margin-top: 0.75rem;
		margin-bottom: 0.25rem;
	}
	:global(.markdown-body ul) {
		list-style-type: disc;
		padding-left: 1.25rem;
		margin-bottom: 0.75rem;
	}
	:global(.markdown-body ol) {
		list-style-type: decimal;
		padding-left: 1.25rem;
		margin-bottom: 0.75rem;
	}
	:global(.markdown-body li) {
		margin-bottom: 0.25rem;
	}
	:global(.code-block-wrapper) {
		margin: 0.85rem 0;
	}
	:global(.code-block-content) {
		position: relative;
		overflow: hidden;
		transition: max-height 0.2s ease;
	}
	:global(.code-collapse-overlay) {
		background: linear-gradient(to top, #09090b, transparent);
	}
	:global(.code-block-wrapper pre) {
		background-color: #09090b !important;
		border: none !important;
		border-radius: 0 !important;
		margin: 0 !important;
		padding: 0.85rem 1rem !important;
	}
	:global(.code-block-wrapper pre code) {
		background-color: transparent !important;
		padding: 0 !important;
		border: none !important;
		font-size: 0.75rem !important;
		line-height: 1.65 !important;
	}
	:global(.hljs) {
		background: transparent !important;
	}
	:global(.markdown-body pre) {
		background-color: #18181b;
		border: 1px solid #27272a;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		color: #f4f4f5;
		overflow-x: auto;
	}
	:global(.markdown-body pre code) {
		background-color: transparent !important;
		padding: 0 !important;
		border: none !important;
		font-size: inherit !important;
		color: inherit !important;
	}
	:global(.markdown-body code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.75rem;
		background-color: #27272a;
		border: 1px solid #3f3f46;
		color: #67e8f9;
		padding: 0.15rem 0.35rem;
		border-radius: 0.375rem;
	}
	:global(.markdown-body blockquote) {
		border-left: 3px solid #52525b;
		padding-left: 0.75rem;
		margin: 0.75rem 0;
		color: #a1a1aa;
		font-style: italic;
	}
	:global(.markdown-body table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.75rem 0;
		font-size: 0.75rem;
	}
	:global(.markdown-body th),
	:global(.markdown-body td) {
		border: 1px solid #27272a;
		padding: 0.5rem 0.75rem;
		text-align: left;
	}
	:global(.markdown-body th) {
		background-color: #18181b;
		color: #e4e4e7;
		font-weight: 600;
	}
	:global(.markdown-body tr:nth-child(even)) {
		background-color: rgba(24, 24, 27, 0.4);
	}
	:global(.markdown-body a) {
		color: #22d3ee;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.markdown-body hr) {
		border: 0;
		border-top: 1px solid #27272a;
		margin: 1.25rem 0;
	}
</style>
