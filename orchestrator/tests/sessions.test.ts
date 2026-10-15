import { describe, expect, test } from 'bun:test';
import { deleteProviderSession, type SessionFetch, type SessionResponse } from '../src/providers/sessions';

const ENDPOINT = 'http://127.0.0.1:8000/v1';

/** Capture console.warn for the duration of fn, then restore it. */
async function captureWarn(fn: () => Promise<unknown>): Promise<string[]> {
	const original = console.warn;
	const lines: string[] = [];
	console.warn = (...args: any[]) => {
		lines.push(args.map((a) => String(a)).join(' '));
	};
	try {
		await fn();
	} finally {
		console.warn = original;
	}
	return lines;
}

/** A stub fetch that records the call and answers with a fixed response. */
function stubFetch(response: SessionResponse) {
	const calls: { url: string; init: any }[] = [];
	const impl: SessionFetch = async (url, init) => {
		calls.push({ url, init });
		return response;
	};
	return { impl, calls };
}

describe('deleteProviderSession', () => {
	test('requests the plural /sessions/ route with the encoded tab id', async () => {
		const { impl, calls } = stubFetch({ ok: true, status: 200 });

		const result = await deleteProviderSession(ENDPOINT, 'tab/with space', impl);

		expect(result).toEqual({ ok: true, status: 200 });
		expect(calls.length).toBe(1);
		expect(calls[0].url).toBe(`${ENDPOINT}/sessions/tab%2Fwith%20space`);
		expect(calls[0].url).toContain('/sessions/');
		expect(calls[0].url).not.toMatch(/\/session\//);
		expect(calls[0].init.method).toBe('DELETE');
	});

	test('strips a trailing slash from the endpoint', async () => {
		const { impl, calls } = stubFetch({ ok: true, status: 200 });

		await deleteProviderSession('http://127.0.0.1:8000/v1/', 'tab1', impl);

		expect(calls[0].url).toBe(`${ENDPOINT}/sessions/tab1`);
	});

	test('a non-OK response is a failure naming the endpoint, the tab and the status', async () => {
		const { impl } = stubFetch({ ok: false, status: 500 });

		let result: any;
		const warns = await captureWarn(async () => {
			result = await deleteProviderSession(ENDPOINT, 'tab-500', impl);
		});

		expect(result).toEqual({ ok: false, status: 500 });
		expect(warns.length).toBe(1);
		expect(warns[0]).toContain(ENDPOINT);
		expect(warns[0]).toContain('tab-500');
		expect(warns[0]).toContain('500');
	});

	test('a rejected fetch returns the error and does not throw', async () => {
		const impl: SessionFetch = async () => {
			throw new Error('connect ECONNREFUSED');
		};

		let result: any;
		const warns = await captureWarn(async () => {
			result = await deleteProviderSession(ENDPOINT, 'tab-unreachable', impl);
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain('ECONNREFUSED');
		expect(warns.length).toBe(1);
	});
});
