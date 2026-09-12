/**
 * Utility to reliably start window dragging on desktop (Tauri v2).
 * Guards against non-primary mouse buttons and interactive elements.
 */
export function handleWindowDrag(e: MouseEvent): void {
	// Only trigger on primary left click
	if (e.buttons !== 1 && e.button !== 0) return;

	// Do not start drag if user clicked an interactive element
	const target = e.target as HTMLElement | null;
	if (
		target?.closest(
			'button, input, textarea, select, a, [role="tab"], [role="button"], .no-drag, [data-no-drag]'
		)
	) {
		return;
	}

	// Trigger Tauri v2 window drag programmatically
	try {
		const tauri = (window as any).__TAURI__;
		if (tauri?.window?.getCurrentWindow) {
			tauri.window.getCurrentWindow().startDragging();
		}
	} catch (err) {
		// Harmless fallback in pure browser environments
	}
}

/**
 * Programmatically minimize / shrink the desktop window.
 */
export async function handleShrinkWindow(): Promise<void> {
	try {
		const tauri = (window as any).__TAURI__;
		if (tauri?.window?.getCurrentWindow) {
			const win = tauri.window.getCurrentWindow();
			await win.minimize();
		}
	} catch (err) {
		console.warn('Window minimize failed:', err);
	}
}
