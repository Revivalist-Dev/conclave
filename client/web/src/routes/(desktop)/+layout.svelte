<script lang="ts">
	import { onMount } from 'svelte';
	import { harness } from '$lib/stores/harness.svelte';
	import WindowFrame from '$lib/components/WindowFrame.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import NewChatModal from '$lib/components/NewChatModal.svelte';

	let { children } = $props();

	onMount(() => {
		harness.loadInitialData();
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
