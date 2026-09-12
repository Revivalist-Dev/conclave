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
		HardDrive
	} from 'lucide-svelte';

	let searchOpen = $state(false);
	let isCreatingProject = $state(false);
	let newProjectName = $state('');
	let expandedProjects = $state<Record<string, boolean>>({});

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

<aside
	class="w-56 flex-shrink-0 flex flex-col h-full bg-zinc-950/95 border-r border-zinc-800/80 select-none text-xs transition-all duration-200 {harness.sidebarOpen
		? 'opacity-100'
		: '-ml-64 opacity-0 pointer-events-none'}"
>
	<!-- Top App Branding: brainstorm-app-icon.png, brAInstorm text, and [+] New Conversation button -->
	<div
		data-tauri-drag-region
		onmousedown={handleWindowDrag}
		class="relative p-0 pl-2 pr-2.5 flex items-center justify-between flex-shrink-0 min-h-[62px] border-b border-zinc-800/40 select-none cursor-default"
	>
		<div data-tauri-drag-region class="flex items-center gap-2.5 z-10 select-none pointer-events-none">
			<img
				data-tauri-drag-region
				src="/brainstorm-app-icon.png"
				alt="brAInstorm"
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
							<button
								type="button"
								onclick={() => handleSelectThread(thread.id)}
								class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-100 group {isActive
									? 'bg-zinc-800/90 text-zinc-100 font-medium shadow-sm'
									: 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'}"
							>
								<span class="truncate text-xs">{thread.title}</span>

								<!-- Delete thread action button on hover -->
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
									class="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-[11px] p-0.5 rounded ml-1 transition-opacity cursor-pointer"
									title="Delete thread"
								>
									✕
								</span>
							</button>
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
							<button
								type="button"
								onclick={() => handleSelectThread(thread.id)}
								class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all duration-100 group {isActive
									? 'bg-zinc-800/90 text-zinc-100 font-medium shadow-sm'
									: 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'}"
							>
								<span class="truncate text-xs">{thread.title}</span>
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
									class="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-[11px] p-0.5 rounded ml-1 transition-opacity cursor-pointer"
									title="Delete thread"
								>
									✕
								</span>
							</button>
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
