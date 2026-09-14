/** Tiny event bus so plugin internals can notify the WS layer without circular imports. */
type BusHandler = (payload: any) => void;

const handlers: Record<string, BusHandler[]> = {};

export const pluginBus = {
	on(event: string, fn: BusHandler) {
		(handlers[event] ||= []).push(fn);
	},
	emit(event: string, payload?: any) {
		for (const fn of handlers[event] || []) {
			try {
				fn(payload);
			} catch {}
		}
	}
};
