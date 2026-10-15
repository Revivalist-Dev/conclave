import { describe, expect, test } from 'bun:test';
import { pluginBus } from '../src/plugins/bus';

/** Capture console.warn for the duration of fn, then restore it. */
function captureWarn(fn: () => void): string[] {
	const original = console.warn;
	const lines: string[] = [];
	console.warn = (...args: any[]) => {
		lines.push(args.map((a) => String(a)).join(' '));
	};
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return lines;
}

describe('pluginBus.emit', () => {
	test('logs exactly one warn naming the event and the error text', () => {
		const event = 'test-throw-event';
		pluginBus.on(event, () => {
			throw new Error('handler exploded');
		});

		const warns = captureWarn(() => pluginBus.emit(event, {}));

		expect(warns.length).toBe(1);
		expect(warns[0]).toContain('[PluginBus]');
		expect(warns[0]).toContain(`Handler for "${event}" threw:`);
		expect(warns[0]).toContain('handler exploded');
	});

	test('a throwing handler does not stop later handlers for the same event', () => {
		const event = 'test-continue-event';
		let laterRan = false;
		pluginBus.on(event, () => {
			throw new Error('first fails');
		});
		pluginBus.on(event, () => {
			laterRan = true;
		});

		const warns = captureWarn(() => pluginBus.emit(event, {}));

		expect(laterRan).toBe(true);
		expect(warns.length).toBe(1);
	});

	test('a non-Error throw is still named', () => {
		const event = 'test-non-error-event';
		pluginBus.on(event, () => {
			throw 'plain string failure';
		});

		const warns = captureWarn(() => pluginBus.emit(event, {}));

		expect(warns.length).toBe(1);
		expect(warns[0]).toContain('plain string failure');
	});

	test('an event with no handlers logs nothing', () => {
		const warns = captureWarn(() => pluginBus.emit('test-no-handlers-event', {}));
		expect(warns.length).toBe(0);
	});
});
