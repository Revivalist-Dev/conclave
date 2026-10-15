import { describe, expect, test } from 'bun:test';
import { dedupeInFlight } from '../src/processes/inflight';

/** A factory that resolves only when the returned release function is called. */
function deferred() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { gate, release };
}

describe('dedupeInFlight', () => {
	test('runs the factory once for concurrent calls on the same key', async () => {
		const inflight = new Map<string, Promise<string>>();
		let calls = 0;
		const { gate, release } = deferred();
		const factory = async () => {
			calls++;
			await gate;
			return 'DanyAPI:running';
		};

		const first = dedupeInFlight(inflight, 'DanyAPI', factory);
		const second = dedupeInFlight(inflight, 'DanyAPI', factory);
		const third = dedupeInFlight(inflight, 'DanyAPI', factory);

		expect(calls).toBe(1);
		release();
		expect(await first).toBe('DanyAPI:running');
		expect(await second).toBe('DanyAPI:running');
		expect(await third).toBe('DanyAPI:running');
		expect(calls).toBe(1);
	});

	test('lets a later call retry once the first has settled', async () => {
		const inflight = new Map<string, Promise<number>>();
		let calls = 0;
		const factory = async () => ++calls;

		expect(await dedupeInFlight(inflight, 'DanyAPI', factory)).toBe(1);
		expect(inflight.size).toBe(0);
		expect(await dedupeInFlight(inflight, 'DanyAPI', factory)).toBe(2);
	});

	test('does not couple distinct keys', async () => {
		const inflight = new Map<string, Promise<string>>();
		const started: string[] = [];
		const factory = async (name: string) => {
			started.push(name);
			return name;
		};

		await Promise.all([
			dedupeInFlight(inflight, 'DanyAPI', () => factory('DanyAPI')),
			dedupeInFlight(inflight, 'Other', () => factory('Other'))
		]);

		expect(started.sort()).toEqual(['DanyAPI', 'Other']);
	});

	test('shares a rejection with every caller and drops the entry', async () => {
		const inflight = new Map<string, Promise<void>>();
		let calls = 0;
		const factory = async () => {
			calls++;
			throw new Error('docker compose up failed');
		};

		const first = dedupeInFlight(inflight, 'DanyAPI', factory);
		const second = dedupeInFlight(inflight, 'DanyAPI', factory);

		await expect(first).rejects.toThrow('docker compose up failed');
		await expect(second).rejects.toThrow('docker compose up failed');
		expect(calls).toBe(1);
		// Not cached: the failure can be retried by the next caller.
		expect(inflight.size).toBe(0);
	});

	test('drops the entry when the factory throws synchronously', async () => {
		const inflight = new Map<string, Promise<void>>();
		const factory = (() => {
			throw new Error('settings read failed');
		}) as () => Promise<void>;

		await expect(dedupeInFlight(inflight, 'DanyAPI', factory)).rejects.toThrow('settings read failed');
		expect(inflight.size).toBe(0);
	});
});
