<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Conclave — LLM UI</title>
</svelte:head>

{@render children()}


