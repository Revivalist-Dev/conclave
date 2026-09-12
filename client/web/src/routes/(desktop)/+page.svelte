<script lang="ts">
	import TabsHeader from '$lib/components/TabsHeader.svelte';
	import ConversationView from '$lib/components/ConversationView.svelte';
	import PromptInput from '$lib/components/PromptInput.svelte';
</script>

<!-- Header with Conversation Tab(s) beside the sidebar -->
<TabsHeader />

<!-- Message stream with tool step pills -->
<ConversationView />

<!-- Floating compact prompt bar -->
<PromptInput />
