<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import type { Attachment } from '../types';
	import {
		Plus,
		Mic,
		ArrowUp,
		ChevronDown,
		Cpu,
		Folder,
		Check,
		Sparkles,
		Paperclip,
		FileText,
		Image as ImageIcon,
		X,
		Loader2
	} from 'lucide-svelte';

	let text = $state('');
	let textareaEl = $state<HTMLTextAreaElement>();
	let fileInputEl = $state<HTMLInputElement>();
	let isModelMenuOpen = $state(false);
	let attachedFiles = $state<Attachment[]>([]);

	let isSubmitting = $state(false);

	const activeConv = $derived(harness.activeConversation);
	const hasReadyAttachments = $derived(attachedFiles.some((f) => f.status === 'ready'));
	const isUploadingAny = $derived(attachedFiles.some((f) => f.status === 'uploading'));
	const canSubmit = $derived(
		(text.trim().length > 0 || hasReadyAttachments) && !harness.isGenerating && !isUploadingAny && !isSubmitting
	);

	const models = $derived(
		harness.availableModels.map((m) => ({
			id: m.id,
			label: m.name,
			desc: m.desc || m.provider
		}))
	);

	function formatBytes(bytes: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleSubmit() {
		if (!canSubmit || isSubmitting) return;
		isSubmitting = true;
		try {
			const query = text;
			const readyAttachments = attachedFiles
				.filter((f) => f.status === 'ready')
				.map((f) => ({
					name: f.name,
					size: f.size,
					filepath: f.filepath,
					mimeType: f.mimeType
				}));

			text = '';
			attachedFiles = [];
			if (textareaEl) {
				textareaEl.style.height = 'auto';
			}
			isModelMenuOpen = false;
			harness.sendMessage(query, readyAttachments);
		} finally {
			setTimeout(() => {
				isSubmitting = false;
			}, 300);
		}
	}

	function handleInput() {
		if (textareaEl) {
			textareaEl.style.height = 'auto';
			textareaEl.style.height = Math.min(textareaEl.scrollHeight, 140) + 'px';
		}
	}

	function selectModel(modelId: string) {
		harness.setActiveModel(modelId);
		isModelMenuOpen = false;
	}

	function handleOutsideClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.llm-selector-container')) {
			isModelMenuOpen = false;
		}
	}

	function uploadFiles(files: FileList | File[]) {
		const fileArray = Array.from(files);
		if (fileArray.length === 0) return;

		for (const file of fileArray) {
			const fileItem: Attachment = {
				id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
				name: file.name,
				size: file.size,
				mimeType: file.type || 'application/octet-stream',
				status: 'uploading'
			};
			attachedFiles.push(fileItem);
			uploadSingleFile(fileItem, file);
		}
	}

	async function uploadSingleFile(fileItem: Attachment, file: File) {
		try {
			const sessionId = activeConv?.chatId || activeConv?.id || `chat-${Date.now()}`;
			const formData = new FormData();
			formData.append('file', file);
			formData.append('session_id', sessionId);
			formData.append('model', harness.selectedLlmModel || 'Deepseek v4');

			const res = await fetch('http://127.0.0.1:4000/api/upload', {
				method: 'POST',
				body: formData
			});

			if (res.ok) {
				const result = await res.json();
				if (result.success !== false) {
					fileItem.status = 'ready';
					fileItem.filepath = result.filepath;
					console.log('✅ File staged successfully:', fileItem.name, result);
				} else {
					fileItem.status = 'error';
					fileItem.error = result.error || 'Upload failed';
					console.warn('File upload rejected by DanyAPI:', fileItem.name, result.error);
				}
			} else {
				let errMsg = 'Upload failed';
				try {
					const errJson = await res.json();
					errMsg = errJson.error || errJson.detail || errMsg;
				} catch {
					errMsg = (await res.text()) || errMsg;
				}
				fileItem.status = 'error';
				fileItem.error = errMsg;
				console.warn('File upload failed:', fileItem.name, errMsg);
			}
		} catch (err: any) {
			fileItem.status = 'error';
			fileItem.error = err.message;
			console.error('File upload error:', fileItem.name, err.message);
		}
	}

	function handleFileInputChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			uploadFiles(target.files);
		}
		target.value = '';
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			uploadFiles(e.dataTransfer.files);
		}
	}

	function removeFile(index: number) {
		attachedFiles.splice(index, 1);
	}
</script>

<svelte:window onclick={handleOutsideClick} />

<div class="px-[8px] pb-[4px] pt-1 flex justify-center w-full select-none">
	<!-- Hidden File Input (supports multiple) -->
	<input
		type="file"
		multiple
		bind:this={fileInputEl}
		onchange={handleFileInputChange}
		class="hidden"
	/>

	<div
		ondragover={(e) => e.preventDefault()}
		ondrop={handleDrop}
		class="w-full flex flex-col rounded-xl bg-zinc-900/95 border border-zinc-800 shadow-2xl backdrop-blur-md transition-all focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700/50"
	>
		<!-- Attached Files Preview Bar -->
		{#if attachedFiles.length > 0}
			<div class="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
				{#each attachedFiles as file, index}
					<div
						class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/90 border border-zinc-700/70 text-xs text-zinc-200 shadow-sm"
					>
						{#if file.mimeType?.startsWith('image/')}
							<ImageIcon class="w-3 h-3 text-cyan-400 flex-shrink-0" />
						{:else}
							<FileText class="w-3 h-3 text-cyan-400 flex-shrink-0" />
						{/if}
						<span class="font-medium truncate max-w-[180px] text-[11px]" title={file.name}>{file.name}</span>
						<span class="text-[9px] text-zinc-400 font-mono">({formatBytes(file.size)})</span>
						{#if file.status === 'uploading'}
							<Loader2 class="w-3 h-3 animate-spin text-zinc-400 flex-shrink-0" />
						{:else if file.status === 'ready'}
							<span class="text-[9px] px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50 font-medium">
								ready
							</span>
						{:else}
							<span
								class="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-800/60 font-medium flex items-center gap-1 cursor-help"
								title={file.error || 'Upload failed'}
							>
								<span>failed</span>
								{#if file.error}
									<span class="text-rose-400 font-normal truncate max-w-[120px] opacity-80">({file.error.length > 25 ? file.error.slice(0, 25) + '…' : file.error})</span>
								{/if}
							</span>
						{/if}
						<button
							type="button"
							onclick={() => removeFile(index)}
							class="text-zinc-500 hover:text-zinc-300 ml-0.5 p-0.5 rounded transition-colors"
							title="Remove file"
						>
							<X class="w-3 h-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Upper Input Row: Plus / Attach + Textarea -->
		<div class="flex items-start gap-2 px-3 pt-2.5 pb-1">
			<!-- Plus / Attachment Button: Opens File Dialog -->
			<button
				type="button"
				class="flex items-center justify-center w-6 h-6 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors flex-shrink-0 mt-0.5"
				title="Attach files (images, docs) or drag & drop multiple"
				onclick={() => fileInputEl?.click()}
			>
				<Plus class="w-4 h-4" />
			</button>

			<!-- Prompt Input Textarea -->
			<textarea
				bind:this={textareaEl}
				bind:value={text}
				onkeydown={handleKeydown}
				oninput={handleInput}
				placeholder={attachedFiles.length > 1 ? `Ask about these ${attachedFiles.length} attached files...` : attachedFiles.length === 1 ? "Ask about the attached file..." : "Ask anything, @ tools, or / for commands..."}
				rows={1}
				class="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 resize-none outline-none leading-relaxed py-1 max-h-36 selectable-text"
			></textarea>
		</div>

		<!-- Bottom Toolbar Row: LLM Selector on Left, Directory Badge, Mic & Send on Right -->
		<div class="flex items-center justify-between px-3 py-1.5 border-t border-zinc-800/50 text-xs">
			<!-- Left side controls: LLM selector pill & optional directory badge -->
			<div class="flex items-center gap-2 relative llm-selector-container">
				<!-- LLM Selector Pill -->
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						isModelMenuOpen = !isModelMenuOpen;
					}}
					class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 hover:border-zinc-600 text-zinc-200 transition-all text-left shadow-sm cursor-pointer"
					title="Select Model (Current: {harness.selectedLlmModel || 'Deepseek v4'})"
				>
					<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
					<span class="font-medium text-[11px] text-zinc-200">
						{harness.selectedLlmModel || 'Deepseek v4'}
					</span>
					<ChevronDown class="w-3 h-3 text-zinc-400 transition-transform {isModelMenuOpen ? 'rotate-180' : ''}" />
				</button>

				<!-- Directory badge if active conversation has projectDirectory -->
				{#if activeConv?.projectDirectory}
					<button
						type="button"
						onclick={() => harness.openNewChatModal(activeConv.group)}
						class="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 border border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors text-[10px] font-mono truncate max-w-[200px]"
						title="Project Directory: {activeConv.projectDirectory} (Click to change)"
					>
						<Folder class="w-3 h-3 text-zinc-500 flex-shrink-0" />
						<span class="truncate">{activeConv.projectDirectory}</span>
					</button>
				{/if}

				<!-- Dropdown Model Menu -->
				{#if isModelMenuOpen}
					<div
						class="absolute bottom-full left-0 mb-1.5 w-60 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-50 p-1 animate-in fade-in zoom-in-95 duration-100"
					>
						<div class="px-2.5 py-1.5 border-b border-zinc-800 flex items-center justify-between text-[10px] text-zinc-400">
							<span class="font-semibold uppercase tracking-wider text-zinc-300">Model</span>
							<span class="text-emerald-400 flex items-center gap-1 font-mono">
								<span class="w-1 h-1 rounded-full bg-emerald-400"></span>
								:8000
							</span>
						</div>

						<div class="py-1 space-y-0.5">
							{#each models as m}
								{@const isSelected = (harness.selectedLlmModel || 'Deepseek v4') === m.id}
								<button
									type="button"
									onclick={() => selectModel(m.id)}
									class="w-full flex items-start justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors {isSelected
										? 'bg-zinc-800 text-zinc-100'
										: 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}"
								>
									<div class="min-w-0">
										<div class="flex items-center gap-1.5">
											<span class="text-xs font-medium font-mono text-zinc-200">{m.label}</span>
										</div>
										<p class="text-[10px] text-zinc-500 leading-tight mt-0.5 truncate">{m.desc}</p>
									</div>
									{#if isSelected}
										<Check class="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Right side: Voice input & Send button -->
			<div class="flex items-center gap-1.5 flex-shrink-0">
				<!-- Voice input button -->
				<button
					type="button"
					class="flex items-center justify-center w-6 h-6 rounded-full text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
					title="Voice input"
				>
					<Mic class="w-3.5 h-3.5" />
				</button>

				<!-- Send / Submit Button -->
				<button
					type="button"
					onclick={handleSubmit}
					disabled={!canSubmit}
					class="flex items-center justify-center w-6 h-6 rounded-full transition-all {canSubmit
						? 'bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95 shadow-md cursor-pointer'
						: 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50'}"
					title={harness.isGenerating ? 'Generating response...' : isUploadingAny ? 'Uploading files...' : 'Send prompt (Enter)'}
				>
					<ArrowUp class="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	</div>
</div>
