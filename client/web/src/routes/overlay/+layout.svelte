<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>brAInstorm Overlay</title>
</svelte:head>

<div class="overlay-root">
	{@render children()}
</div>

<style>
	:global(html), :global(body) {
		background: transparent !important;
		margin: 0;
		padding: 0;
		overflow: hidden;
		user-select: none;
		-webkit-user-select: none;
	}

	.overlay-root {
		width: 100vw;
		height: 100vh;
		background: transparent;
		overflow: hidden;
	}
</style>
