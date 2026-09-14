<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Brain,
		MoreVertical,
		Maximize2,
		Power,
		X,
		CornerDownLeft,
		ExternalLink,
		AlertCircle,
		Sparkles
	} from 'lucide-svelte';
	import {
		IDLE_HUD_WIDTH,
		IDLE_HUD_HEIGHT,
		exitMinimalistWindow,
		setOverlayWindowSize,
		emitTauriEvent,
		exitApp,
		initWindowListeners,
		listenTauriEvent
	} from '$lib/services/windowManager';
	import { orchestratorSocket } from '$lib/services/orchestratorSocket.svelte';
	import { harness } from '$lib/stores/harness.svelte';

	let isHovered = $state(false);
	let isMenuOpen = $state(false);
	let priorHeight = $state<number | null>(null);
	let priorWidth = $state<number | null>(null);

	// Normal small overlay size constants (fixed & immutable)
	const NORMAL_HUD_WIDTH = IDLE_HUD_WIDTH; // 300
	const NORMAL_HUD_HEIGHT = IDLE_HUD_HEIGHT; // 56

	// Overlay States: 'idle' | 'prompt' | 'thinking' | 'response' | 'error'
	let overlayState = $state<'idle' | 'prompt' | 'thinking' | 'response' | 'error'>('idle');

	// Prompt state
	let promptInput = $state('');
	let promptInputEl = $state<HTMLTextAreaElement>();
	let promptDimensions = $state<{ width: number; height: number } | null>(null);

	// Response state
	let responseText = $state('');
	let responseModel = $state(harness.selectedLlmModel);
	let totalDuration = $state(15);
	let secondsRemaining = $state(15);
	let isHoveringResponse = $state(false);
	let countdownTimer: any = null;

	// Error state
	let errorMessage = $state('');

	// Thinking / Generation tracking
	let isThinkingInBackground = $state(false);
	let thinkingTimeout: any = null;

	// Orchestrator coordination (transport lives in Tauri; see orchestrator_ws.rs).
	// Active tab + active model state and their functions live in the shared
	// harness store — the same functions the desktop window uses.
	let unlistenMessage: (() => void) | null = null;
	let unlistenStatus: (() => void) | null = null;

	// Last resort when the harness has no tab at all: the DB bootstrap seeds the
	// first tab (Base58 sequence 1 → '1112') under the default 'Discussions' project.
	const DEFAULT_TAB_ID = '1112';

	async function restoreIdleDimensions() {
		await setOverlayWindowSize(NORMAL_HUD_WIDTH, NORMAL_HUD_HEIGHT);
	}

	function clearThinkingTimeout() {
		if (thinkingTimeout) {
			clearTimeout(thinkingTimeout);
			thinkingTimeout = null;
		}
	}

	function clearCountdown() {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
	}

	onMount(() => {
		initWindowListeners();

		// Active tab and active model are restored by the shared harness store;
		// no per-window duplication here.

		// Load custom prompt dimensions if previously saved
		try {
			const saved = localStorage.getItem('brainstorm_prompt_dims');
			if (saved) {
				const parsed = JSON.parse(saved);
				if (parsed && parsed.width >= 340 && parsed.height >= 56) {
					promptDimensions = parsed;
				}
			}
		} catch {}

		// Ensure overlay starts at strict idle size
		restoreIdleDimensions();

		// The WebSocket lives in Tauri (orchestrator_ws.rs); we only listen for its
		// events here. Connecting, reconnects and backoff are handled natively.
		orchestratorSocket.connect();
		listenTauriEvent('orchestrator-message', (data: any) => {
			handleOrchestratorMessage(data);
		}).then((fn) => (unlistenMessage = fn));
		listenTauriEvent('orchestrator-status', (payload: any) => {
			// Rust serializes the status enum as a bare JSON string; accept a wrapper too.
			const status = typeof payload === 'string' ? payload : payload?.status;
			if (
				status === 'disconnected' &&
				(overlayState === 'thinking' || isThinkingInBackground)
			) {
				clearThinkingTimeout();
				isThinkingInBackground = false;
				showErrorMessage('Connection to AI orchestrator lost.');
			}
		}).then((fn) => (unlistenStatus = fn));

		const onFocus = () => {
			// Pick up tab switches made in the main window while the HUD was open
			try {
				const saved = localStorage.getItem('brainstorm_active_tab');
				if (saved && saved !== harness.activeConversationId) harness.selectConversation(saved);
			} catch {}
		};
		window.addEventListener('focus', onFocus);

		return () => {
			clearCountdown();
			clearThinkingTimeout();
			window.removeEventListener('focus', onFocus);
			unlistenMessage?.();
			unlistenStatus?.();
		};
	});

	function handleOrchestratorMessage(data: any) {
		try {
			// SETTINGS_LOADED / TAB_CREATED / TAB_UPDATED are handled by the bridge,
			// which feeds the shared harness store (tabs, active tab, active model).
			// The HUD only reacts to its own in-flight generation:
			if (data.type === 'CHAT_TOKEN') {
				if (isThinkingInBackground || overlayState === 'thinking') {
					responseText += data.token || '';
				}
			} else if (data.type === 'CHAT_COMPLETE') {
				if (isThinkingInBackground || overlayState === 'thinking') {
					clearThinkingTimeout();
					isThinkingInBackground = false;
					if (data.model) responseModel = data.model;
					try {
						localStorage.setItem('brainstorm_refresh_ts', Date.now().toString());
					} catch {}
					showResponseCard();
				} else if (overlayState === 'idle' || overlayState === 'response') {
					// Completed for a prompt that started elsewhere (e.g. typed
					// fullscreen, then minimized before the reply): surface it
					// in the HUD and follow its conversation.
					popExternalResponse(data.tabId || data.conversationId, data.model);
				}
			} else if (data.type === 'CHAT_ERROR') {
				if (isThinkingInBackground || overlayState === 'thinking') {
					clearThinkingTimeout();
					isThinkingInBackground = false;
					showErrorMessage(data.error || 'Failed to get response');
				} else if (overlayState === 'idle' || overlayState === 'response') {
					// Failed for a prompt that started elsewhere (e.g. typed
					// fullscreen, then minimized before the reply): surface the
					// failure in the HUD and follow its conversation.
					popExternalError(data.tabId || data.conversationId, data.error);
				}
			}
		} catch (err) {
			console.warn('[Overlay] Orchestrator message error:', err);
		}
	}

	async function ensureActiveTab(): Promise<string> {
		if (harness.activeConversationId) return harness.activeConversationId;

		// Same creation path the desktop uses; the server's TAB_CREATED broadcast is
		// routed into the harness by the bridge, which sets activeConversationId.
		harness.createConversation('Discussions');
		await new Promise((r) => setTimeout(r, 200));
		if (harness.activeConversationId) return harness.activeConversationId;

		// Last resort: the DB bootstrap seeds a default 'Discussions' tab as the first
		// tab (Base58 sequence 1 → '1112'). Only missing if that tab was deleted.
		return DEFAULT_TAB_ID;
	}

	async function handleBrainClick(e: MouseEvent) {
		e.stopPropagation();

		if (overlayState === 'idle') {
			overlayState = 'prompt';
			const targetW = promptDimensions?.width ?? 480;
			const targetH = promptDimensions?.height ?? 80;
			await setOverlayWindowSize(Math.max(380, targetW), Math.max(68, targetH));
			setTimeout(() => {
				promptInputEl?.focus();
			}, 60);
		} else if (overlayState === 'prompt') {
			await cancelPrompt();
		} else if (overlayState === 'thinking') {
			// Minimize to idle while allowing generation to continue in background
			overlayState = 'idle';
			await restoreIdleDimensions();
		} else if (overlayState === 'response') {
			await dismissResponse();
		} else if (overlayState === 'error') {
			await dismissError();
		}
	}

	async function cancelPrompt() {
		promptInput = '';
		overlayState = 'idle';
		await restoreIdleDimensions();
	}

	function handlePromptKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmitPrompt();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelPrompt();
		}
	}

	function handleGlobalKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (isMenuOpen) {
				closeMenu();
			} else if (overlayState === 'error') {
				dismissError();
			} else if (overlayState === 'response') {
				dismissResponse();
			} else if (overlayState === 'prompt') {
				cancelPrompt();
			}
		}
	}

	async function handleSubmitPrompt() {
		const text = promptInput.trim();
		if (!text) return;

		promptInput = '';
		responseText = '';
		errorMessage = '';
		overlayState = 'thinking';
		isThinkingInBackground = true;
		await restoreIdleDimensions();

		clearThinkingTimeout();
		// 60-second timeout guard on thinking state
		thinkingTimeout = setTimeout(() => {
			if (isThinkingInBackground || overlayState === 'thinking') {
				isThinkingInBackground = false;
				showErrorMessage('Generation timed out after 60 seconds.');
			}
		}, 60000);

		const tabId = await ensureActiveTab();
		// If the socket is down, the Rust bridge queues this payload and flushes it
		// on reconnect; the 60s thinking timeout is the safety net if it never returns.
		orchestratorSocket.send({
			type: 'PROMPT_SEND',
			tabId,
			conversationId: tabId,
			chatId: tabId,
			sessionId: tabId,
			content: text,
			provider: harness.selectedLlmProvider,
			model: harness.selectedLlmModel
		});
	}

	async function showErrorMessage(msg: string) {
		clearCountdown();
		clearThinkingTimeout();
		isThinkingInBackground = false;
		errorMessage = msg || 'An unexpected error occurred';
		overlayState = 'error';

		// Expand overlay for error: compact height (72px), comfortable width (440-560px)
		const targetW = Math.max(440, Math.min(560, (promptDimensions?.width ?? 480)));
		const targetH = 72;
		await setOverlayWindowSize(targetW, targetH);

		secondsRemaining = 10;
		countdownTimer = setInterval(() => {
			if (!isHoveringResponse && overlayState === 'error') {
				secondsRemaining--;
				if (secondsRemaining <= 0) {
					dismissError();
				}
			}
		}, 1000);
	}

	async function dismissError() {
		clearCountdown();
		overlayState = 'idle';
		errorMessage = '';
		await restoreIdleDimensions();
	}

	async function showResponseCard() {
		clearThinkingTimeout();
		isThinkingInBackground = false;

		// If response text is an error, route to transparent error display
		if (responseText.toLowerCase().startsWith('error:') || responseText.toLowerCase().startsWith('error')) {
			showErrorMessage(responseText.replace(/^error:\s*/i, ''));
			return;
		}

		overlayState = 'response';
		clearCountdown();

		// Sizing for response card: width 540 (was 440), height 140 (was 130)
		const targetW = Math.max(480, Math.min(750, (promptDimensions?.width ?? 540)));
		const targetH = Math.max(130, Math.min(450, (promptDimensions?.height ? promptDimensions.height + 40 : 140)));
		await setOverlayWindowSize(targetW, targetH);

		// Preview duration comes from the shared harness settings (same source as Settings UI)
		totalDuration = harness.settings.overlayResponseDuration ?? 15;
		secondsRemaining = totalDuration;

		countdownTimer = setInterval(() => {
			if (!isHoveringResponse && overlayState === 'response') {
				secondsRemaining--;
				if (secondsRemaining <= 0) {
					dismissResponse();
				}
			}
		}, 1000);
	}

	async function dismissResponse() {
		clearCountdown();
		overlayState = 'idle';
		responseText = '';
		await restoreIdleDimensions();
	}

	/**
	 * Present a response that completed for a prompt started in another window
	 * (e.g. typed fullscreen, then minimized before the reply). The HUD follows
	 * that conversation: subsequent typing goes to it, and the hidden main window
	 * is switched + populated via the storage event / refresh events.
	 */
	async function popExternalResponse(tabId: string | null, model?: string) {
		if (!tabId) return;
		harness.selectConversation(tabId);
		await harness.fetchTabMessages(tabId);
		const msgs = harness.activeConversation?.messages || [];
		const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content);
		if (!lastAssistant) return;
		// The user may have started interacting while the fetch ran; don't clobber it.
		if (overlayState !== 'idle' && overlayState !== 'response') return;
		responseText = lastAssistant.content;
		responseModel = model || lastAssistant.model || harness.selectedLlmModel;
		await showResponseCard();
	}

	/**
	 * Surface a failure from a prompt that started in another window (e.g. typed
	 * fullscreen, then minimized before the reply). Same contract as the external
	 * response pop: the HUD follows that conversation for subsequent typing.
	 */
	function popExternalError(tabId: string | null, error?: string) {
		if (!tabId || (overlayState !== 'idle' && overlayState !== 'response')) return;
		harness.selectConversation(tabId);
		showErrorMessage(error || 'The response failed in another window.');
	}

	async function handleOpenInChat() {
		clearCountdown();
		overlayState = 'idle';
		await restoreIdleDimensions();

		const tabToRestore = harness.activeConversationId || null;

		if (tabToRestore && typeof localStorage !== 'undefined') {
			localStorage.setItem('brainstorm_active_tab', tabToRestore);
			localStorage.setItem('brainstorm_refresh_ts', Date.now().toString());
		}

		await emitTauriEvent('refresh-active-thread', { tabId: tabToRestore });
		await emitTauriEvent('switch-tab', { tabId: tabToRestore });
		await exitMinimalistWindow(tabToRestore || undefined);
	}

	const MIN_MENU_HEIGHT = 135;
	const MIN_MENU_WIDTH = 200;

	// Resizing state
	let resizeHandleEl = $state<HTMLDivElement>();

	async function toggleMenu(e: MouseEvent) {
		e.stopPropagation();
		if (isMenuOpen) {
			await closeMenu();
		} else {
			await openMenu();
		}
	}

	async function openMenu() {
		isMenuOpen = true;
		const currentW = window.innerWidth;
		const currentH = window.innerHeight;

		let targetW = currentW;
		let targetH = currentH;
		let needsResize = false;

		if (currentH < MIN_MENU_HEIGHT) {
			priorHeight = currentH;
			targetH = MIN_MENU_HEIGHT;
			needsResize = true;
		}

		if (currentW < MIN_MENU_WIDTH) {
			priorWidth = currentW;
			targetW = MIN_MENU_WIDTH;
			needsResize = true;
		}

		if (needsResize) {
			await setOverlayWindowSize(targetW, targetH);
		}
	}

	async function closeMenu() {
		if (!isMenuOpen && priorHeight === null && priorWidth === null) return;
		isMenuOpen = false;

		if (priorHeight !== null || priorWidth !== null) {
			const restoreW = priorWidth !== null ? priorWidth : window.innerWidth;
			const restoreH = priorHeight !== null ? priorHeight : window.innerHeight;
			priorHeight = null;
			priorWidth = null;
			await setOverlayWindowSize(restoreW, restoreH);
		}
	}

	async function handleRestore() {
		await closeMenu();
		const tabToRestore = harness.activeConversationId || null;

		if (tabToRestore && typeof localStorage !== 'undefined') {
			localStorage.setItem('brainstorm_active_tab', tabToRestore);
			localStorage.setItem('brainstorm_refresh_ts', Date.now().toString());
		}

		await emitTauriEvent('refresh-active-thread', { tabId: tabToRestore });
		await emitTauriEvent('switch-tab', { tabId: tabToRestore });
		await exitMinimalistWindow(tabToRestore || undefined);
	}

	async function handleQuit() {
		await closeMenu();
		await exitApp();
	}

	// Bottom-right resize handle with RAF throttling
	function handleResizePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();

		if (isMenuOpen) {
			isMenuOpen = false;
			priorHeight = null;
			priorWidth = null;
		}

		const startX = e.screenX;
		const startY = e.screenY;
		const startWidth = window.innerWidth;
		const startHeight = window.innerHeight;
		let lastW = startWidth;
		let lastH = startHeight;
		let rafId: number | null = null;

		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);

		function onPointerMove(moveEvent: PointerEvent) {
			const dx = moveEvent.screenX - startX;
			const dy = moveEvent.screenY - startY;
			const minW = overlayState === 'prompt' ? 280 : overlayState === 'response' ? 320 : NORMAL_HUD_WIDTH;
			const minH = overlayState === 'prompt' ? 64 : overlayState === 'response' ? 80 : NORMAL_HUD_HEIGHT;
			const newW = Math.max(minW, Math.min(900, Math.round(startWidth + dx)));
			const newH = Math.max(minH, Math.min(600, Math.round(startHeight + dy)));
			lastW = newW;
			lastH = newH;

			if (!rafId) {
				rafId = requestAnimationFrame(() => {
					rafId = null;
					setOverlayWindowSize(lastW, lastH);
				});
			}
		}

		function onPointerUp(upEvent: PointerEvent) {
			target.removeEventListener('pointermove', onPointerMove);
			target.removeEventListener('pointerup', onPointerUp);
			target.removeEventListener('pointercancel', onPointerUp);
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			try {
				target.releasePointerCapture(upEvent.pointerId);
			} catch {}

			if (overlayState === 'prompt') {
				promptDimensions = {
					width: lastW,
					height: lastH
				};
				try {
					localStorage.setItem('brainstorm_prompt_dims', JSON.stringify(promptDimensions));
				} catch {}
			}
		}

		target.addEventListener('pointermove', onPointerMove);
		target.addEventListener('pointerup', onPointerUp);
		target.addEventListener('pointercancel', onPointerUp);
	}
</script>

<svelte:window onclick={closeMenu} onkeydown={handleGlobalKeyDown} />

<!-- Main Overlay Container: Pure Transparent HUD -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="overlay-container relative w-full h-full {isHovered ? 'window-hovered' : ''} {overlayState === 'prompt' ? 'prompt-active' : ''} {overlayState === 'response' ? 'response-active' : ''} {overlayState === 'error' ? 'error-active' : ''}"
	data-tauri-drag-region
	onmouseenter={() => (isHovered = true)}
	onmouseleave={() => {
		isHovered = false;
		closeMenu();
	}}
>
	<!-- Content: Transparent Brain Icon aligned to the very left (1px padding from window edge) -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<main
		class="flex-1 flex items-center justify-start h-full pl-[1px] pr-0 overflow-hidden select-none"
		data-tauri-drag-region
	>
		<!-- Brain Icon button / glow -->
		<div
			class="brain-btn flex items-center justify-center relative group p-0 flex-shrink-0 cursor-pointer active:scale-95 transition-transform"
			onclick={handleBrainClick}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handleBrainClick(e as any);
				}
			}}
			role="button"
			tabindex="0"
			title={overlayState === 'prompt'
				? 'Cancel prompt (Esc)'
				: overlayState === 'thinking' || isThinkingInBackground
					? 'AI is thinking... (Click to collapse)'
					: overlayState === 'error'
						? `Dismiss error: ${errorMessage}`
						: overlayState === 'response'
							? 'Dismiss response'
							: 'Ask follow-up question'}
		>
			<div
				class="brain-glow absolute inset-0 rounded-full blur-md transition-all duration-300 {overlayState === 'thinking' || isThinkingInBackground
					? 'opacity-90 bg-amber-400/60 animate-pulse'
					: overlayState === 'error'
						? 'opacity-85 bg-rose-500/60 animate-pulse'
						: overlayState === 'response'
							? 'opacity-60 bg-emerald-400/50'
							: 'opacity-35 group-hover:opacity-75 bg-cyan-400/40'}"
			></div>
			<div class="relative p-0 flex items-center justify-center w-8 h-8">
				<Brain
					class="w-8 h-8 transition-colors {overlayState === 'thinking' || isThinkingInBackground
						? 'text-amber-300 drop-shadow-[0_0_12px_rgba(251,191,36,0.75)]'
						: overlayState === 'error'
							? 'text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.85)]'
							: overlayState === 'response'
								? 'text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.75)]'
								: 'text-cyan-300 group-hover:text-cyan-200 drop-shadow-[0_0_12px_rgba(6,182,212,0.65)]'}"
				/>
			</div>
		</div>

		<!-- BESIDE THE BRAIN: Prompt Input Mode -->
		{#if overlayState === 'prompt'}
			<div
				class="prompt-container flex-1 flex items-stretch h-full py-1.5 gap-1.5 pl-2.5 pr-8 select-auto overflow-hidden"
				data-no-drag
			>
				<div
					class="relative flex-1 flex flex-col justify-between bg-zinc-950/95 border border-cyan-500/50 rounded-xl px-2.5 py-1.5 shadow-2xl backdrop-blur-md focus-within:border-cyan-400 overflow-hidden"
				>
					<textarea
						bind:this={promptInputEl}
						bind:value={promptInput}
						onkeydown={handlePromptKeyDown}
						rows="1"
						placeholder="Ask a question..."
						class="w-full flex-1 bg-transparent text-[13.5px] text-zinc-100 placeholder-zinc-500 outline-none resize-none leading-relaxed font-sans"
					></textarea>
					<div class="flex items-center justify-between pt-1 border-t border-white/5 mt-0.5 flex-shrink-0 gap-2">
					<select
						bind:value={harness.selectedLlmModel}
						onchange={(e) => harness.setActiveModel(e.currentTarget.value)}
						class="max-w-[170px] text-[11px] font-mono bg-zinc-900 border border-white/10 rounded px-1 py-0.5 text-zinc-300 outline-none hover:border-cyan-500/40 focus:border-cyan-400/60 cursor-pointer truncate transition-colors"
						title="Active model for prompts in this conversation"
					>
						{#if !harness.availableModels.some((m) => m.id === harness.selectedLlmModel)}
							<option value={harness.selectedLlmModel}>{harness.selectedLlmModel}</option>
						{/if}
							{#each harness.availableModels as m (m.id)}
								<option value={m.id}>{m.name}</option>
							{/each}
						</select>
						<span class="text-xs text-zinc-400 truncate">↵ to send, Shift+↵ newline</span>
						<button
							type="button"
							onclick={handleSubmitPrompt}
							disabled={!promptInput.trim()}
							class="p-1 rounded-md text-cyan-400 hover:text-cyan-200 hover:bg-cyan-500/20 disabled:text-zinc-600 disabled:hover:bg-transparent transition-colors cursor-pointer"
							title="Send prompt (Enter)"
						>
							<CornerDownLeft class="w-3.5 h-3.5" />
						</button>
					</div>
				</div>

				<button
					type="button"
					onclick={cancelPrompt}
					class="p-1 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex-shrink-0 self-start mt-1"
					title="Cancel (Esc)"
				>
					<X class="w-3.5 h-3.5" />
				</button>
			</div>
		{:else if overlayState === 'response'}
			<!-- BESIDE THE BRAIN: Response Preview Card with Countdown Bar -->
			<div
				class="response-container flex-1 flex items-stretch h-full py-1.5 gap-1.5 pl-2.5 pr-8 select-auto overflow-hidden"
				data-no-drag
				onmouseenter={() => (isHoveringResponse = true)}
				onmouseleave={() => (isHoveringResponse = false)}
				role="region"
				aria-label="AI Response Preview"
			>
				<div
					class="relative flex-1 flex flex-col justify-between bg-zinc-950/95 border border-cyan-500/40 rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md overflow-hidden"
				>
					<!-- Card Header -->
					<div class="flex items-center justify-between pb-1 mb-1 border-b border-white/5 flex-shrink-0">
						<div class="flex items-center gap-1.5">
							<span class="text-xs text-zinc-300 font-medium font-mono">
								{secondsRemaining}s {isHoveringResponse ? '(paused)' : ''}
							</span>
						</div>

						<div class="flex items-center gap-1">
							<button
								type="button"
								onclick={handleOpenInChat}
								class="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-cyan-300 hover:text-cyan-100 hover:bg-cyan-500/20 transition-colors cursor-pointer"
								title="Open in full desktop chat"
							>
								<span>Open Chat</span>
								<ExternalLink class="w-3 h-3" />
							</button>
						</div>
					</div>

					<!-- Card Content -->
					<div
						class="response-text flex-1 overflow-y-auto text-[13.5px] text-zinc-100 leading-relaxed pr-1 select-text cursor-pointer font-sans"
						onclick={handleOpenInChat}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleOpenInChat();
							}
						}}
						role="button"
						tabindex="0"
						title="Click to open in full chat window"
					>
						{responseText || 'Thinking complete.'}
					</div>

					<!-- 15-second animated progress countdown bar at card bottom -->
					<div class="w-full h-1 bg-zinc-800/80 rounded-full overflow-hidden mt-1 flex-shrink-0">
						<div
							class="h-full bg-cyan-400 transition-all duration-1000 ease-linear rounded-full"
							style="width: {(secondsRemaining / (totalDuration || 15)) * 100}%"
						></div>
					</div>
				</div>

				<button
					type="button"
					onclick={dismissResponse}
					class="p-1 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex-shrink-0 self-start mt-1"
					title="Dismiss (Esc)"
				>
					<X class="w-3.5 h-3.5" />
				</button>
			</div>
		{:else if overlayState === 'error'}
			<!-- BESIDE THE BRAIN: Error Message Display with Transparent Background -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="error-container flex-1 flex items-center h-full py-1.5 gap-1.5 pl-2.5 pr-8 select-auto overflow-hidden"
				data-no-drag
				onmouseenter={() => (isHoveringResponse = true)}
				onmouseleave={() => (isHoveringResponse = false)}
				role="alert"
				aria-live="assertive"
			>
				<div
					class="relative flex-1 flex items-center justify-between bg-transparent border border-rose-500/50 rounded-xl px-2.5 py-1.5 shadow-2xl overflow-hidden min-h-[46px]"
					style="background: transparent !important;"
				>
					<!-- Left: Alert icon & Error Text -->
					<div class="flex items-center gap-2 min-w-0 flex-1 pr-1">
						<div class="flex items-center justify-center w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex-shrink-0">
							<AlertCircle class="w-3 h-3" />
						</div>
						<div class="flex flex-col min-w-0 flex-1 justify-center">
							<div class="flex items-center gap-1.5">
								<span class="text-[11px] font-semibold tracking-wider text-rose-400 uppercase">
									Error
								</span>
								<span class="text-xs text-zinc-400 font-mono">
									{secondsRemaining}s {isHoveringResponse ? '(paused)' : ''}
								</span>
							</div>
							<p
								class="text-[13.5px] text-rose-100 font-medium truncate leading-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
								title={errorMessage}
							>
								{errorMessage}
							</p>
						</div>
					</div>

					<!-- Right: Dismiss button -->
					<button
						type="button"
						onclick={dismissError}
						class="p-1 rounded-md text-rose-400/80 hover:text-rose-200 hover:bg-rose-500/20 transition-colors cursor-pointer flex-shrink-0"
						title="Dismiss error and return to small overlay (Esc)"
					>
						<X class="w-3.5 h-3.5" />
					</button>
				</div>
			</div>
		{/if}
	</main>

	<!-- Floating Chrome Controls: Top-Right Menu & Bottom-Right Resize Handle -->
	<div class="chrome-overlay absolute inset-0 pointer-events-none z-50 overflow-visible">
		<!-- Top-Right Controls: [ ⋮ Menu ] -->
		<div class="window-controls-cluster absolute top-1.5 right-1.5 flex items-center pointer-events-auto">
			<div class="relative">
				<button
					type="button"
					onclick={toggleMenu}
					title="Menu"
					class="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
				>
					<MoreVertical class="w-3.5 h-3.5" />
				</button>

				<!-- Dropdown Menu -->
				{#if isMenuOpen}
					<div
						class="menu-dropdown absolute right-0 top-full mt-1 w-44 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur-md shadow-2xl p-1 z-50 flex flex-col gap-0.5"
					>
						<button
							type="button"
							onclick={handleRestore}
							class="menu-item flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-left"
						>
							<Maximize2 class="w-3.5 h-3.5 text-cyan-400" />
							<span>Restore Full Window</span>
						</button>

						<div class="border-t border-white/10 my-1"></div>

						<button
							type="button"
							onclick={handleQuit}
							class="menu-item flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-200 hover:bg-rose-500/15 rounded-lg transition-colors cursor-pointer text-left"
						>
							<Power class="w-3.5 h-3.5 text-rose-400" />
							<span>Quit brAInstorm</span>
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Bottom-Right Window Resize Handle (6-dot triangle grip) -->
		<div
			bind:this={resizeHandleEl}
			onpointerdown={handleResizePointerDown}
			class="resize-handle absolute bottom-1 right-1 p-1 text-zinc-500 hover:text-cyan-300 select-none pointer-events-auto cursor-nwse-resize transition-opacity"
			title="Drag to resize window"
		>
			<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
				<circle cx="20" cy="20" r="2" />
				<circle cx="14" cy="20" r="2" />
				<circle cx="20" cy="14" r="2" />
				<circle cx="8" cy="20" r="2" />
				<circle cx="14" cy="14" r="2" />
				<circle cx="20" cy="8" r="2" />
			</svg>
		</div>
	</div>
</div>

<style>
	/* Pure transparent container */
	.overlay-container {
		height: 100vh;
		width: 100vw;
		display: flex;
		flex-direction: row;
		align-items: center;
		background: transparent !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
		border: 1px solid transparent;
		border-radius: 14px;
		overflow: hidden;
		box-shadow: none;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	/* Mouse-over window outline: shows window boundary for moving/resizing */
	.overlay-container.window-hovered {
		border: 1px solid rgba(255, 255, 255, 0.22);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
		background: transparent !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	.chrome-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 50;
		overflow: visible;
	}

	.resize-handle {
		position: absolute;
		bottom: 2px;
		right: 2px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease, color 0.15s ease, transform 0.15s ease;
		cursor: nwse-resize;
		z-index: 60;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: flex-end;
		justify-content: flex-end;
		padding: 2px;
		-webkit-app-region: no-drag;
	}

	.overlay-container:hover .resize-handle,
	.overlay-container.window-hovered .resize-handle,
	.overlay-container.prompt-active .resize-handle,
	.overlay-container.response-active .resize-handle,
	.overlay-container.error-active .resize-handle {
		opacity: 0.75;
		pointer-events: auto;
	}

	.resize-handle:hover {
		opacity: 1 !important;
		color: #38bdf8;
		transform: scale(1.15);
	}

	.window-controls-cluster {
		position: absolute;
		top: 4px;
		right: 6px;
		z-index: 100;
	}

	.menu-dropdown {
		animation: menuFadeIn 0.15s ease-out;
	}

	@keyframes menuFadeIn {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* Custom scrollbar for response preview text */
	.response-text::-webkit-scrollbar {
		width: 4px;
	}
	.response-text::-webkit-scrollbar-track {
		background: transparent;
	}
	.response-text::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.15);
		border-radius: 4px;
	}
	.response-text::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.3);
	}
</style>
