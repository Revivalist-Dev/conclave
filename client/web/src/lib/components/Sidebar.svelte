<script lang="ts">
	import { harness } from '../stores/harness.svelte';
	import { orchestratorSocket } from '../services/orchestratorSocket.svelte';
	import { handleWindowDrag } from '../utils/drag';
	import ProviderFilter from './ProviderFilter.svelte';
	import { goto } from '$app/navigation';
	import {
		Folder,
		FolderPlus,
		MessageSquare,
		MessagesSquare,
		Plus,
		PanelLeftClose,
		Search,
		ChevronDown,
		Clock,
		Sparkles,
		Settings,
		HardDrive,
		Archive,
		MoreVertical,
		Pencil,
		Download
	} from 'lucide-svelte';

	let searchOpen = $state(false);
	let isCreatingProject = $state(false);
	let newProjectName = $state('');
	let expandedProjects = $state<Record<string, boolean>>({});

	const archivedThreads = $derived(harness.conversations.filter((c) => c.archived));

	// === Per-thread hover menu (⋮) + inline rename ===
	let menuThreadId = $state<string | null>(null);
	let menuPos = $state<{ top: number; right: number } | null>(null);
	let renamingThreadId = $state<string | null>(null);
	let renameValue = $state('');
	let renameInputEl = $state<HTMLInputElement>();

	const menuThread = $derived(harness.conversations.find((c) => c.id === menuThreadId));

	function toggleMenu(e: MouseEvent | KeyboardEvent, threadId: string) {
		e.stopPropagation();
		if (menuThreadId === threadId) {
			closeMenu();
			return;
		}
		// Fixed positioning escapes the sidebar's scroll clipping
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		menuPos = { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) };
		menuThreadId = threadId;
	}

	function closeMenu() {
		menuThreadId = null;
		menuPos = null;
	}

	function startRename() {
		if (!menuThread) return;
		renamingThreadId = menuThread.id;
		renameValue = menuThread.title;
		closeMenu();
		setTimeout(() => renameInputEl?.focus(), 30);
	}

	function commitRename(id: string) {
		if (renamingThreadId === id) harness.renameConversation(id, renameValue);
		renamingThreadId = null;
	}

	function cancelRename() {
		renamingThreadId = null;
	}

	function archiveThread(id: string) {
		harness.archiveConversation(id, true);
		closeMenu();
	}

	function downloadThread(id: string) {
		harness.downloadConversation(id);
		closeMenu();
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function handleSelectThread(threadId: string) {
		harness.selectConversation(threadId);
		if (typeof window !== 'undefined' && window.location.pathname !== '/') {
			goto('/');
		}
	}

	function handleOpenNewChat(projectName = 'Discussions') {
		harness.openNewChatModal(projectName);
		if (typeof window !== 'undefined' && window.location.pathname !== '/') {
			goto('/');
		}
	}

	function toggleProjectExpand(key: string) {
		expandedProjects[key] = !expandedProjects[key];
	}

	const projectsToDisplay = $derived.by(() => {
		if (harness.serverProjects.length > 0) {
			return harness.serverProjects;
		}
		return (harness.projects.length > 0 ? harness.projects : ['Discussions']).map((name, i) => ({
			id: `p-${i}`,
			name,
			icon: name === 'Discussions' ? 'MessagesSquare' : 'Folder'
		}));
	});

	const orphanThreads = $derived.by(() => {
		const projectIds = new Set(projectsToDisplay.map((p) => p.id));
		const projectNames = new Set(projectsToDisplay.map((p) => p.name));
		return harness.filteredConversations.filter(
			(c) => (!c.project_id || !projectIds.has(c.project_id)) && (!c.group || !projectNames.has(c.group))
		);
	});

	function handleCreateProjectSubmit(e: SubmitEvent | KeyboardEvent) {
		if ('key' in e && e.key !== 'Enter') return;
		if (newProjectName.trim()) {
			harness.addProject(newProjectName.trim());
			newProjectName = '';
			isCreatingProject = false;
		}
	}
</script>

<svelte:window onclick={closeMenu} onkeydown={(e) => e.key === 'Escape' && closeMenu()} />

<aside
	class="w-56 flex-shrink-0 flex flex-col h-full bg-zinc-950/95 border-r border-zinc-800/80 select-none text-xs transition-all duration-200 {harness.sidebarOpen
		? 'opacity-100'
		: '-ml-64 opacity-0 pointer-events-none'}"
>
	<!-- Top App Branding: conclave-app-icon.png, Conclave text, and [+] New Conversation button -->
	<div
		data-tauri-drag-region
		onmousedown={handleWindowDrag}
		class="relative p-0 pl-2 pr-2.5 flex items-center justify-between flex-shrink-0 min-h-[62px] border-b border-zinc-800/40 select-none cursor-default"
	>
		<div data-tauri-drag-region class="flex items-center gap-2.5 z-10 select-none pointer-events-none">
			<img
				data-tauri-drag-region
				src="/conclave-app-icon.png"
				alt="Conclave"
				class="w-[42px] h-[42px] object-cover rounded-xl select-none drop-shadow-md flex-shrink-0"
			/>
			<div data-tauri-drag-region class="flex items-center tracking-tight font-bold text-base text-zinc-100 select-none">
				<span>br</span><span class="text-cyan-400">AI</span><span>nstorm</span>
			</div>
		</div>

		<!-- [+] New Conversation button: distinct, prominent button floated to the right -->
		<button
			type="button"
			onclick={() => handleOpenNewChat()}
			class="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:scale-95 border border-zinc-700/90 text-zinc-100 hover:text-white transition-all shadow-md cursor-pointer z-10 hover:border-zinc-500 flex-shrink-0"
			title="New Conversation"
		>
			<Plus class="w-6 h-6 text-zinc-100 hover:text-white" strokeWidth={2.5} />
		</button>
	</div>

	<!-- Optional Search input -->
	{#if searchOpen}
		<div class="px-3 py-1.5 bg-zinc-900/40 border-b border-zinc-800/40">
			<div class="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs">
				<Search class="w-3 h-3 text-zinc-500 flex-shrink-0" />
				<input
					type="text"
					bind:value={harness.searchQuery}
					placeholder="Filter chats..."
					class="w-full bg-transparent text-zinc-200 placeholder-zinc-500 outline-none text-xs"
				/>
				{#if harness.searchQuery}
					<button
						type="button"
						onclick={() => (harness.searchQuery = '')}
						class="text-zinc-500 hover:text-zinc-300 text-[10px]"
					>
						✕
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Projects Header Row: Projects ⌵, Search (before filter), Filter, [+] New Project, Collapse Sidebar -->
	<div class="px-3 pt-2.5 pb-1.5 flex items-center justify-between text-zinc-300 flex-shrink-0">
		<!-- Collapse Sidebar Button -->
		<button
			type="button"
			onclick={() => harness.toggleSidebar()}
			class="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
			title="Collapse Sidebar"
		>
			<PanelLeftClose class="w-4 h-4" />
		</button>


		<!-- Right Controls: Search (before filter), Filter, [+] for new project, and collapse sidebar (spaced out) -->
		<div class="flex items-center gap-2">
			<!-- Search toggle button (before the filter) -->
			<button
				type="button"
				onclick={() => (searchOpen = !searchOpen)}
				class="p-1.5 rounded-md transition-colors {searchOpen
					? 'text-zinc-100 bg-zinc-800/80 border border-zinc-700/60'
					: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'}"
				title="Search conversations"
			>
				<Search class="w-4 h-4" />
			</button>

			<!-- Filter Icon with Provider dropdown -->
			<ProviderFilter variant="icon" />

			<!-- [+] New Project Button (Folder with plus icon) -->
			<button
				type="button"
				onclick={() => (isCreatingProject = !isCreatingProject)}
				class="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
				title="New Project"
			>
				<FolderPlus class="w-4 h-4" />
			</button>
		</div>
	</div>

	<!-- Inline New Project Input if creating -->
	{#if isCreatingProject}
		<div class="px-3 py-1.5 bg-zinc-900/50 border-b border-zinc-800/60">
			<div class="flex items-center gap-1.5">
				<Folder class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
				<input
					type="text"
					bind:value={newProjectName}
					onkeydown={handleCreateProjectSubmit}
					placeholder="Project name..."
					class="w-full bg-zinc-900 px-2 py-1 rounded text-zinc-200 placeholder-zinc-500 text-xs outline-none border border-zinc-700"
				/>
				<button
					type="button"
					onclick={() => handleCreateProjectSubmit(new KeyboardEvent('keydown', { key: 'Enter' }))}
					class="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px]"
				>
					Add
				</button>
				<button
					type="button"
					onclick={() => (isCreatingProject = false)}
					class="text-zinc-500 hover:text-zinc-300 px-1 text-xs"
				>
					✕
				</button>
			</div>
		</div>
	{/if}

	<!-- Conversation List grouped by Projects -->
	{#if harness.projectsExpanded}
		<div class="flex-1 overflow-y-auto px-2 py-2 space-y-3.5">
			{#if projectsToDisplay.length === 0 && orphanThreads.length === 0}
				<div class="px-3 py-6 text-center text-zinc-500 text-xs">
					No projects found
				</div>
			{/if}

			{#each projectsToDisplay as project (project.id || project.name)}
				{@const threads = harness.filteredConversations
					.filter((c) => (c.project_id && c.project_id === project.id) || c.group === project.name)
					.sort((a, b) => b.updatedAt - a.updatedAt)}
				{@const totalThreads = threads.length}
				{@const isExpanded = !!expandedProjects[project.id || project.name]}
				{@const displayThreads = isExpanded ? threads : threads.slice(0, 6)}
				{@const hasMore = totalThreads > 6}

				<div class="space-y-1">
					<!-- Project Header: Icon + Project Title + [+] New Thread button -->
					<div
						class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-zinc-300 tracking-tight group"
					>
						<div class="flex items-center gap-1.5 truncate">
							{#if project.icon === 'MessagesSquare' || project.name === 'Discussions'}
								<MessagesSquare class="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
							{:else}
								<Folder class="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
							{/if}
							<span class="truncate">{project.name}</span>
						</div>
						<button
							type="button"
							onclick={() => handleOpenNewChat(project.name)}
							class="text-zinc-500 hover:text-zinc-200 p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
							title="New thread in {project.name}"
						>
							<Plus class="w-3.5 h-3.5" />
						</button>
					</div>

					<!-- Discussion Threads: Top 6 (or all if expanded) -->
					<div class="space-y-0.5 pl-1">
						{#if threads.length === 0}
							<div class="px-2.5 py-1 text-zinc-600 text-[11px] italic">
								No threads yet
							</div>
						{/if}

						{#each displayThreads as thread (thread.id)}
							{@const isActive = harness.activeConversationId === thread.id}
							<div
								role="button"
								tabindex="0"
								onclick={() => renamingThreadId !== thread.id && handleSelectThread(thread.id)}
								onkeydown={(e) => {
									if ((e.key === 'Enter' || e.key === ' ') && renamingThreadId !== thread.id) {
										e.preventDefault();
										handleSelectThread(thread.id);
									}
								}}
								class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-100 group cursor-pointer {isActive
									? 'bg-zinc-800/90 text-zinc-100 font-medium shadow-sm'
									: 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'}"
							>
								{#if renamingThreadId === thread.id}
									<input
										bind:this={renameInputEl}
										bind:value={renameValue}
										use:focusOnMount
										onclick={(e) => e.stopPropagation()}
										onkeydown={(e) => {
											if (e.key === 'Enter') commitRename(thread.id);
											else if (e.key === 'Escape') cancelRename();
										}}
										onblur={() => commitRename(thread.id)}
										class="w-full bg-zinc-950 border border-cyan-500/50 rounded px-1 py-0.5 text-xs text-zinc-100 outline-none"
									/>
								{:else}
									<span class="truncate text-xs">{thread.title}</span>

									<!-- Hover actions: ⋮ menu + delete -->
									<span class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1">
										<span
											role="button"
											tabindex="0"
											onclick={(e) => toggleMenu(e, thread.id)}
											onkeydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') toggleMenu(e, thread.id);
											}}
											class="text-zinc-500 hover:text-cyan-300 text-[11px] p-0.5 rounded transition-colors cursor-pointer"
											title="Thread actions"
										>
											<MoreVertical class="w-3 h-3" />
										</span>
										<span
											role="button"
											tabindex="0"
											onclick={(e) => {
												e.stopPropagation();
												harness.deleteConversation(thread.id);
											}}
											onkeydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.stopPropagation();
													harness.deleteConversation(thread.id);
												}
											}}
											class="text-zinc-500 hover:text-red-400 text-[11px] p-0.5 rounded transition-colors cursor-pointer"
											title="Delete thread"
										>
											✕
										</span>
									</span>
								{/if}
							</div>
						{/each}

						{#if hasMore}
							<button
								type="button"
								onclick={() => toggleProjectExpand(project.id || project.name)}
								class="w-full flex items-center justify-between px-2.5 py-1 text-[11px] font-medium text-cyan-400/90 hover:text-cyan-300 hover:bg-zinc-900/40 rounded transition-colors text-left cursor-pointer"
							>
								<span>{isExpanded ? 'Show less ▴' : `Show all (${totalThreads}) ▾`}</span>
							</button>
						{/if}
					</div>
				</div>
			{/each}

			{#if orphanThreads.length > 0}
				<div class="space-y-1 pt-2 border-t border-zinc-800/40">
					<div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-zinc-400 tracking-tight">
						<div class="flex items-center gap-1.5 truncate">
							<MessageSquare class="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
							<span class="truncate">Other</span>
						</div>
					</div>
					<div class="space-y-0.5 pl-1">
						{#each orphanThreads as thread (thread.id)}
							{@const isActive = harness.activeConversationId === thread.id}
							<div
								role="button"
								tabindex="0"
								onclick={() => renamingThreadId !== thread.id && handleSelectThread(thread.id)}
								onkeydown={(e) => {
									if ((e.key === 'Enter' || e.key === ' ') && renamingThreadId !== thread.id) {
										e.preventDefault();
										handleSelectThread(thread.id);
									}
								}}
								class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-100 group cursor-pointer {isActive
									? 'bg-zinc-800/90 text-zinc-100 font-medium shadow-sm'
									: 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'}"
							>
								{#if renamingThreadId === thread.id}
									<input
										bind:this={renameInputEl}
										bind:value={renameValue}
										use:focusOnMount
										onclick={(e) => e.stopPropagation()}
										onkeydown={(e) => {
											if (e.key === 'Enter') commitRename(thread.id);
											else if (e.key === 'Escape') cancelRename();
										}}
										onblur={() => commitRename(thread.id)}
										class="w-full bg-zinc-950 border border-cyan-500/50 rounded px-1 py-0.5 text-xs text-zinc-100 outline-none"
									/>
								{:else}
									<span class="truncate text-xs">{thread.title}</span>

									<span class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1">
										<span
											role="button"
											tabindex="0"
											onclick={(e) => toggleMenu(e, thread.id)}
											onkeydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') toggleMenu(e, thread.id);
											}}
											class="text-zinc-500 hover:text-cyan-300 text-[11px] p-0.5 rounded transition-colors cursor-pointer"
											title="Thread actions"
										>
											<MoreVertical class="w-3 h-3" />
										</span>
										<span
											role="button"
											tabindex="0"
											onclick={(e) => {
												e.stopPropagation();
												harness.deleteConversation(thread.id);
											}}
											onkeydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.stopPropagation();
													harness.deleteConversation(thread.id);
												}
											}}
											class="text-zinc-500 hover:text-red-400 text-[11px] p-0.5 rounded transition-colors cursor-pointer"
											title="Delete thread"
										>
											✕
										</span>
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if archivedThreads.length > 0}
				<div class="space-y-1 pt-2 border-t border-zinc-800/40">
					<div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-zinc-500 tracking-tight">
						<div class="flex items-center gap-1.5 truncate">
							<Archive class="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
							<span class="truncate">Archived</span>
						</div>
					</div>
					<div class="space-y-0.5 pl-1">
						{#each archivedThreads as thread (thread.id)}
							<div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg group text-zinc-500 hover:bg-zinc-900/40">
								<span class="truncate text-xs italic">{thread.title}</span>
								<button
									type="button"
									onclick={() => harness.archiveConversation(thread.id, false)}
									class="opacity-0 group-hover:opacity-100 text-[10px] text-zinc-400 hover:text-cyan-300 px-1.5 py-0.5 rounded border border-zinc-700/60 transition-opacity cursor-pointer flex-shrink-0"
									title="Restore thread"
								>
									Unarchive
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<div class="p-3 text-center text-zinc-600 text-[11px]">
			Projects collapsed
		</div>
	{/if}

		<!-- Bottom Row: Settings Link + Orchestrator HardDrive status icon -->
		<div class="p-2 border-t border-zinc-800/60 bg-zinc-950/95 flex-shrink-0 flex items-center justify-between gap-1">
			<a
				href="/settings"
				class="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border border-transparent hover:border-zinc-800/80 transition-all cursor-pointer group"
				title="Model Parameters & Settings"
			>
				<Settings class="w-4 h-4 text-zinc-400 group-hover:text-cyan-400 transition-colors" />
				<span>Settings</span>
			</a>
			<button
				type="button"
				onclick={() => orchestratorSocket.manualReconnect()}
				class="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent hover:border-zinc-800/80 transition-all cursor-pointer flex-shrink-0 {orchestratorSocket.status === 'connected' ? 'text-emerald-400' : orchestratorSocket.status === 'connecting' ? 'text-amber-400 animate-pulse' : 'text-zinc-600'}"
				title="Orchestrator WebSocket: {orchestratorSocket.status === 'connected' ? 'Connected' : orchestratorSocket.status} (Click to reconnect)"
			>
				<HardDrive class="w-4 h-4" />
			</button>
		</div>
	</aside>

{#if menuThreadId && menuPos && menuThread}
	<!-- Fixed-position dropdown so it escapes the sidebar's scroll clipping -->
	<div
		class="fixed z-[100] w-40 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur-md shadow-2xl p-1 flex flex-col gap-0.5"
		style="top: {menuPos.top}px; right: {menuPos.right}px;"
	>
		<button
			type="button"
			onclick={startRename}
			class="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-left"
		>
			<Pencil class="w-3.5 h-3.5 text-cyan-400" />
			<span>Rename</span>
		</button>
		<button
			type="button"
			onclick={() => archiveThread(menuThread.id)}
			class="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-left"
		>
			<Archive class="w-3.5 h-3.5 text-amber-400" />
			<span>Archive</span>
		</button>
		<button
			type="button"
			onclick={() => downloadThread(menuThread.id)}
			class="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-left"
		>
			<Download class="w-3.5 h-3.5 text-emerald-400" />
			<span>Download</span>
		</button>
	</div>
{/if}
