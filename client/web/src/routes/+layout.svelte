<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>brAInstorm — LLM UI</title>
</svelte:head>

{@render children()}


