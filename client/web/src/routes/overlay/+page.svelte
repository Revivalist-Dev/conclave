<script lang="ts">
	import { Brain, MoreVertical, Maximize2, Power, X, CornerDownLeft } from 'lucide-svelte';
	import { exitMinimalistWindow, syncCurrentBounds, setOverlayWindowSize } from '$lib/services/windowManager';
	import { handleWindowDrag } from '$lib/utils/drag';

	let isHovered = $state(false);
	let isMenuOpen = $state(false);
	let priorHeight = $state<number | null>(null);
	let priorWidth = $state<number | null>(null);

	// Prompt state (Step 1)
	let overlayState = $state<'idle' | 'prompt'>('idle');
	let promptInput = $state('');
	let promptInputEl = $state<HTMLTextAreaElement>();
	let idleDimensions = $state<{ width: number; height: number } | null>(null);

	function saveIdleDimensions() {
		if (idleDimensions === null) {
			idleDimensions = {
				width: window.innerWidth,
				height: window.innerHeight
			};
		}
	}

	async function restoreIdleDimensions() {
		if (idleDimensions !== null) {
			const { width, height } = idleDimensions;
			idleDimensions = null;
			await setOverlayWindowSize(width, height);
		}
	}

	async function handleBrainClick(e: MouseEvent) {
		e.stopPropagation();
		if (overlayState === 'idle') {
			saveIdleDimensions();
			overlayState = 'prompt';
			const baseW = idleDimensions?.width ?? 260;
			const baseH = idleDimensions?.height ?? 76;
			await setOverlayWindowSize(Math.max(380, baseW), Math.max(76, baseH));
			setTimeout(() => {
				promptInputEl?.focus();
			}, 60);
		} else {
			await cancelPrompt();
		}
	}

	async function cancelPrompt() {
		promptInput = '';
		overlayState = 'idle';
		await restoreIdleDimensions();
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
		await exitMinimalistWindow();
	}

	async function handleQuit() {
		await closeMenu();
		try {
			const tauri = (window as any).__TAURI__;
			if (tauri?.window?.getCurrentWindow) {
				await tauri.window.getCurrentWindow().destroy();
			} else {
				window.close();
			}
		} catch {
			window.close();
		}
	}

	// Bottom-right resize handle (modeled directly on llm_gauge)
	function handleResizePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();

		// If menu was open, cancel prior size restore so manual size is kept
		priorHeight = null;
		priorWidth = null;
		isMenuOpen = false;

		const startX = e.screenX;
		const startY = e.screenY;
		const startWidth = window.innerWidth;
		const startHeight = window.innerHeight;

		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);

		function onPointerMove(moveEvent: PointerEvent) {
			const dx = moveEvent.screenX - startX;
			const dy = moveEvent.screenY - startY;
			const newW = Math.max(120, Math.min(800, Math.round(startWidth + dx)));
			const newH = Math.max(56, Math.min(600, Math.round(startHeight + dy)));
			setOverlayWindowSize(newW, newH);
		}

		function onPointerUp(upEvent: PointerEvent) {
			target.removeEventListener('pointermove', onPointerMove);
			target.removeEventListener('pointerup', onPointerUp);
			target.removeEventListener('pointercancel', onPointerUp);
			try {
				target.releasePointerCapture(upEvent.pointerId);
			} catch {}
			syncCurrentBounds();
		}

		target.addEventListener('pointermove', onPointerMove);
		target.addEventListener('pointerup', onPointerUp);
		target.addEventListener('pointercancel', onPointerUp);
	}
</script>

<svelte:window onclick={closeMenu} />

<!-- Main Overlay Container: Pure Transparent HUD modeled on llm_gauge -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="overlay-container relative w-full h-full {isHovered ? 'window-hovered' : ''}"
	data-tauri-drag-region
	onmousedown={handleWindowDrag}
	onmouseenter={() => (isHovered = true)}
	onmouseleave={() => {
		isHovered = false;
		closeMenu();
	}}
>
	<!-- Content: Transparent Brain Icon aligned to the very left (2px max padding from window edge) -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<main
		class="flex-1 flex items-center justify-start h-full pl-[1px] pr-0 overflow-hidden select-none"
		data-tauri-drag-region
	>
		<!-- Brain Icon button / glow -->
		<div
			class="brain-btn flex items-center justify-center relative group p-0 flex-shrink-0 cursor-pointer active:scale-95 transition-transform"
			onclick={handleBrainClick}
			role="button"
			tabindex="0"
			title={overlayState === 'prompt' ? 'Cancel prompt' : 'Ask follow-up question'}
		>
			<div class="brain-glow absolute inset-0 rounded-full blur-md opacity-35 group-hover:opacity-75 transition-opacity bg-cyan-400/40"></div>
			<div class="relative p-0 flex items-center justify-center w-8 h-8">
				<Brain class="w-8 h-8 text-cyan-300 group-hover:text-cyan-200 transition-colors drop-shadow-[0_0_12px_rgba(6,182,212,0.65)]" />
			</div>
		</div>

		<!-- BESIDE THE BRAIN: Prompt Input Mode -->
		{#if overlayState === 'prompt'}
			<div class="prompt-container flex-1 flex items-center gap-1.5 pl-2.5 pr-8 select-auto overflow-hidden" data-no-drag>
				<div class="relative flex-1 flex items-center bg-zinc-950/95 border border-cyan-500/50 rounded-xl px-2.5 py-1 shadow-2xl backdrop-blur-md focus-within:border-cyan-400">
					<textarea
						bind:this={promptInputEl}
						bind:value={promptInput}
						rows="1"
						placeholder="Ask a question..."
						class="w-full bg-transparent text-xs text-zinc-100 placeholder-zinc-500 outline-none resize-none leading-tight py-1 font-sans"
					></textarea>
				</div>

				<button
					type="button"
					onclick={cancelPrompt}
					class="p-1 rounded-md text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex-shrink-0"
					title="Cancel (Esc)"
				>
					<X class="w-3.5 h-3.5" />
				</button>
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
					<div class="menu-dropdown absolute right-0 top-full mt-1 w-44 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur-md shadow-2xl p-1 z-50 flex flex-col gap-0.5">
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

		<!-- Bottom-Right Window Resize Handle (6-dot triangle grip modeled on llm_gauge) -->
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
	/* Pure transparent container copied directly from llm_gauge/src/styles.css */
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

	/* Mouse-over window outline: shows window boundary for moving/resizing (from llm_gauge) */
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
	.overlay-container.window-hovered .resize-handle {
		opacity: 0.7;
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
</style>

