<script lang="ts">
	import { onMount } from 'svelte';
	import { harness } from '$lib/stores/harness.svelte';
	import WindowFrame from '$lib/components/WindowFrame.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import NewChatModal from '$lib/components/NewChatModal.svelte';

	import { listenTauriEvent } from '$lib/services/windowManager';

	let { children } = $props();

	let refreshDebounceTimer: any = null;

	function refreshActiveThread(targetTabId?: string | null) {
		if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
		refreshDebounceTimer = setTimeout(async () => {
			const active =
				targetTabId ||
				(typeof localStorage !== 'undefined' ? localStorage.getItem('brainstorm_active_tab') : null) ||
				harness.activeConversationId;

			if (active) {
				harness.selectConversation(active);
			} else {
				await harness.loadInitialData();
			}
		}, 150);
	}

	onMount(() => {
		harness.loadInitialData();
		harness.initWindowState();

		let unlistenSwitch: (() => void) | null = null;
		let unlistenRefresh: (() => void) | null = null;

		listenTauriEvent('switch-tab', (data: any) => {
			refreshActiveThread(data?.tabId);
		}).then((fn) => {
			unlistenSwitch = fn;
		});

		listenTauriEvent('refresh-active-thread', (data: any) => {
			refreshActiveThread(data?.tabId);
		}).then((fn) => {
			unlistenRefresh = fn;
		});

		// Listen for cross-window localStorage changes (from overlay)
		const onStorage = (e: StorageEvent) => {
			if (e.key === 'brainstorm_active_tab' || e.key === 'brainstorm_refresh_ts') {
				const target = e.key === 'brainstorm_active_tab' ? e.newValue : undefined;
				refreshActiveThread(target);
			}
		};
		window.addEventListener('storage', onStorage);

		// Listen for window focus & visibility changes
		const onFocusOrVisible = () => {
			refreshActiveThread();
		};
		window.addEventListener('focus', onFocusOrVisible);

		const onVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				refreshActiveThread();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		return () => {
			if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
			if (unlistenSwitch) unlistenSwitch();
			if (unlistenRefresh) unlistenRefresh();
			window.removeEventListener('storage', onStorage);
			window.removeEventListener('focus', onFocusOrVisible);
			document.removeEventListener('visibilitychange', onVisibilityChange);
		};
	});
</script>

<WindowFrame>
	<!-- Left Sidebar with macOS controls & Settings at bottom -->
	<Sidebar />

	<!-- Main Area beside the sidebar -->
	<main class="flex-1 flex flex-col h-full bg-zinc-950/60 overflow-hidden relative">
		{@render children()}
	</main>

	<!-- Modal -->
	<NewChatModal />
</WindowFrame>
