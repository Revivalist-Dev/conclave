/**
 * Lives in `tests/` rather than beside the module on purpose: `tsconfig.json`
 * includes `["src", "test", "*"]`, so a `*.test.ts` under `src/` would pull
 * `bun:test` into `svelte-check` and fail without an `@types/bun` dependency.
 * `bun test` discovers it here.
 */
import { describe, expect, test } from 'bun:test';
import {
	PromptDeadline,
	PROMPT_FIRST_TOKEN_TIMEOUT_MS,
	PROMPT_IDLE_TIMEOUT_MS,
	type PromptTimeoutPhase
} from '../src/lib/services/promptDeadline';

/**
 * Deterministic clock for the injected-timer seam. Timers are real objects with
 * a due time; `advance` fires everything due in order, so a cleared timer simply
 * never runs.
 */
function manualClock() {
	let nextId = 1;
	const pending = new Map<number, { fn: () => void; due: number }>();
	let now = 0;

	const timers = {
		setTimeout: (fn: () => void, ms: number) => {
			const id = nextId++;
			pending.set(id, { fn, due: now + ms });
			return id;
		},
		clearTimeout: (id: any) => {
			pending.delete(id as number);
		}
	};

	return {
		timers,
		pendingCount: () => pending.size,
		pendingDelays: () => [...pending.values()].map((t) => t.due - now),
		advance(ms: number) {
			now += ms;
			for (const [id, timer] of [...pending.entries()].sort((a, b) => a[1].due - b[1].due)) {
				if (timer.due <= now) {
					pending.delete(id);
					timer.fn();
				}
			}
		}
	};
}

describe('PromptDeadline', () => {
	test('start() arms the first-token budget and reports the phase on expiry', () => {
		const clock = manualClock();
		const fired: PromptTimeoutPhase[] = [];
		const deadline = new PromptDeadline((phase) => fired.push(phase), clock.timers);

		deadline.start();
		expect(clock.pendingDelays()).toEqual([PROMPT_FIRST_TOKEN_TIMEOUT_MS]);
		expect(fired).toEqual([]);

		clock.advance(PROMPT_FIRST_TOKEN_TIMEOUT_MS);
		expect(fired).toEqual(['first-token']);
		expect(clock.pendingCount()).toBe(0);
	});

	test('noteActivity() swaps the first-token budget for the idle budget', () => {
		const clock = manualClock();
		const fired: PromptTimeoutPhase[] = [];
		const deadline = new PromptDeadline((phase) => fired.push(phase), clock.timers);

		deadline.start();
		clock.advance(10_000);
		deadline.noteActivity();
		expect(clock.pendingDelays()).toEqual([PROMPT_IDLE_TIMEOUT_MS]);

		// The first-token timer was cleared, so only one expiry happens.
		clock.advance(PROMPT_FIRST_TOKEN_TIMEOUT_MS);
		expect(fired).toEqual(['idle']);
	});

	test('clear() on the happy path leaves no timer behind', () => {
		const clock = manualClock();
		const fired: PromptTimeoutPhase[] = [];
		const deadline = new PromptDeadline((phase) => fired.push(phase), clock.timers);

		deadline.start();
		deadline.noteActivity();
		deadline.clear();

		expect(clock.pendingCount()).toBe(0);
		clock.advance(PROMPT_FIRST_TOKEN_TIMEOUT_MS + PROMPT_IDLE_TIMEOUT_MS);
		expect(fired).toEqual([]);
	});

	test('a new send re-arms after a clear', () => {
		const clock = manualClock();
		const fired: PromptTimeoutPhase[] = [];
		const deadline = new PromptDeadline((phase) => fired.push(phase), clock.timers);

		deadline.start();
		deadline.clear();
		deadline.start();

		expect(clock.pendingCount()).toBe(1);
		clock.advance(PROMPT_FIRST_TOKEN_TIMEOUT_MS);
		expect(fired).toEqual(['first-token']);
	});

	test('activity after expiry does not re-arm a settled deadline', () => {
		const clock = manualClock();
		const fired: PromptTimeoutPhase[] = [];
		const deadline = new PromptDeadline((phase) => fired.push(phase), clock.timers);

		deadline.start();
		clock.advance(PROMPT_FIRST_TOKEN_TIMEOUT_MS);
		expect(fired).toEqual(['first-token']);

		deadline.noteActivity();
		expect(clock.pendingCount()).toBe(0);
		clock.advance(PROMPT_IDLE_TIMEOUT_MS);
		expect(fired).toEqual(['first-token']);
	});
});
