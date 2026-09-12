<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div
	class="h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-row overflow-hidden relative select-none"
>
	{@render children()}
</div>
