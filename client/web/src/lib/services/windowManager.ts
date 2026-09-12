/**
 * Window Management Service for brAInstorm
 * Handles seamless transitions between full desktop chat window
 * and transparent, resizable HUD overlay mode in Tauri v2.
 * Persists window coordinates, size, and mode in ~/.brainstorm.json
 */

export interface WindowBounds {
	width: number;
	height: number;
	x?: number;
	y?: number;
}

export interface AppWindowState {
	mode: 'normal' | 'minimalist';
	normal: WindowBounds;
	minimalist: WindowBounds;
}

export const DEFAULT_FULL_BOUNDS: WindowBounds = {
	width: 1240,
	height: 820,
	x: 100,
	y: 100
};

export const DEFAULT_HUD_BOUNDS: WindowBounds = {
	width: 240,
	height: 70,
	x: 24,
	y: 120
};

let cachedState: AppWindowState = {
	mode: 'normal',
	normal: { ...DEFAULT_FULL_BOUNDS },
	minimalist: { ...DEFAULT_HUD_BOUNDS }
};

let listenersInitialized = false;

function getTauriWindow() {
	if (typeof window === 'undefined') return null;
	const tauri = (window as any).__TAURI__;
	if (tauri?.window?.getCurrentWindow) {
		return tauri.window.getCurrentWindow();
	}
	return null;
}

export function isTauriEnvironment(): boolean {
	return !!getTauriWindow();
}

/**
 * Invoke a native Tauri command (handles both Tauri 2 and Tauri 1 conventions)
 */
async function tauriInvoke<T>(command: string, args?: Record<string, any>): Promise<T | null> {
	if (typeof window === 'undefined') return null;
	const tauri = (window as any).__TAURI__;
	try {
		if (tauri?.core?.invoke) {
			return await tauri.core.invoke(command, args);
		}
		if (tauri?.invoke) {
			return await tauri.invoke(command, args);
		}
	} catch (err) {
		console.warn(`[WindowManager] Tauri invoke '${command}' failed:`, err);
	}
	return null;
}

/**
 * Load window state from ~/.brainstorm.json (via Tauri) with localStorage fallback
 */
export async function loadWindowState(): Promise<AppWindowState> {
	// 1. Try Tauri native .brainstorm.json command
	try {
		const nativeState = await tauriInvoke<AppWindowState>('get_window_state');
		if (nativeState && nativeState.mode && nativeState.normal && nativeState.minimalist) {
			cachedState = { ...nativeState };
			return cachedState;
		}
	} catch (e) {
		console.warn('[WindowManager] Could not query native window state:', e);
	}

	// 2. Browser fallback via localStorage
	if (typeof localStorage !== 'undefined') {
		try {
			const savedMode = localStorage.getItem('brainstorm_window_mode');
			if (savedMode === 'minimalist' || savedMode === 'normal') {
				cachedState.mode = savedMode;
			}
			const savedFull = localStorage.getItem('brainstorm_full_bounds');
			if (savedFull) cachedState.normal = JSON.parse(savedFull);
			const savedHud = localStorage.getItem('brainstorm_hud_bounds');
			if (savedHud) cachedState.minimalist = JSON.parse(savedHud);
		} catch {}
	}

	return cachedState;
}

/**
 * Save window state to ~/.brainstorm.json and localStorage
 */
export async function saveWindowState(state: AppWindowState): Promise<void> {
	cachedState = { ...state };

	// 1. Persist to localStorage
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem('brainstorm_window_mode', state.mode);
			localStorage.setItem('brainstorm_full_bounds', JSON.stringify(state.normal));
			localStorage.setItem('brainstorm_hud_bounds', JSON.stringify(state.minimalist));
		} catch {}
	}

	// 2. Persist to ~/.brainstorm.json via native Tauri command
	await tauriInvoke('save_window_state', { state });
}

/**
 * Capture current window coordinates and dimensions, updating cached state
 */
export async function syncCurrentBounds(): Promise<void> {
	const win = getTauriWindow();
	if (!win) return;

	try {
		await tauriInvoke('sync_overlay_bounds');
	} catch (err) {
		// Non-critical, ignore if querying bounds fails during transition
	}
}

/**
 * Setup debounced window move/resize listeners in Tauri to remember window position
 */
export function initWindowListeners(): void {
	if (listenersInitialized || typeof window === 'undefined') return;
	listenersInitialized = true;

	const win = getTauriWindow();
	if (!win) return;

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const scheduleSync = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			syncCurrentBounds();
		}, 600);
	};

	try {
		if (typeof win.onMoved === 'function') {
			win.onMoved(scheduleSync);
		}
		if (typeof win.onResized === 'function') {
			win.onResized(scheduleSync);
		}
	} catch (e) {
		console.warn('[WindowManager] Could not attach move/resize listeners:', e);
	}

	window.addEventListener('beforeunload', () => {
		syncCurrentBounds();
	});
}

/**
 * Set the window always-on-top state.
 * Always-on-top is ONLY enabled when in overlay mode; otherwise it must be off.
 */
export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
	const win = getTauriWindow();
	if (win) {
		try {
			await win.setAlwaysOnTop(enabled);
		} catch (e) {
			console.warn('[WindowManager] win.setAlwaysOnTop failed:', e);
		}
	}
	await tauriInvoke('set_window_always_on_top', { enabled });
}

/**
 * Switch from full window to Minimalist HUD mode
 * Hides main desktop window, shows and focuses transparent overlay window
 */
export async function enterMinimalistWindow(): Promise<void> {
	try {
		const res = await tauriInvoke<AppWindowState>('enter_overlay_mode');
		if (res) {
			cachedState = { ...res };
		}
	} catch (e) {
		console.warn('[WindowManager] enter_overlay_mode failed:', e);
	}
}

/**
 * Switch from Minimalist HUD mode back to Full Chat mode
 * Hides transparent overlay window, shows and focuses main desktop window
 */
export async function exitMinimalistWindow(): Promise<void> {
	try {
		const res = await tauriInvoke<AppWindowState>('exit_overlay_mode');
		if (res) {
			cachedState = { ...res };
		}
	} catch (e) {
		console.warn('[WindowManager] exit_overlay_mode failed:', e);
	}
}

/**
 * Dynamically adjust the HUD window size to accommodate expanded content (e.g. preview, prompt, full response)
 */
export async function adjustHudSize(targetWidth: number, targetHeight: number): Promise<void> {
	await setOverlayWindowSize(targetWidth, targetHeight);
}

/**
 * Set the overlay window size using both native command and JS API
 */
export async function setOverlayWindowSize(width: number, height: number): Promise<void> {
	await tauriInvoke('set_overlay_size', { width, height });
	const win = getTauriWindow();
	if (win) {
		try {
			const tauri = (window as any).__TAURI__;
			if (tauri?.window?.LogicalSize) {
				await win.setSize(new tauri.window.LogicalSize(width, height));
			}
		} catch (err) {
			console.warn('[WindowManager] win.setSize error:', err);
		}
	}
}
