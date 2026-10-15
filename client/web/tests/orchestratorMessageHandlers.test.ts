/**
 * W2 — drives real server→client frames through `OrchestratorSocketClient.handleMessage`
 * for the three types that previously had no `case`. Lives in `tests/` for the same
 * reason as `promptDeadline.test.ts`: `tsconfig.json` includes `["src", "test", "*"]`,
 * so a `*.test.ts` under `src/` would pull `bun:test` into the `svelte-check` gate.
 *
 * The modules under test are Svelte 5 runes modules and `bun test` has no Svelte
 * compiler, so the rune globals are stubbed before the dynamic import below.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

(globalThis as any).$state = (value: any) => value;
const derivedStub: any = (fn: any) => fn();
derivedStub.by = (fn: any) => fn();
(globalThis as any).$derived = derivedStub;

const { orchestratorSocket } = await import('../src/lib/services/orchestratorSocket.svelte.ts');
const { harness } = await import('../src/lib/stores/harness.svelte.ts');

/** Feed one frame through the single dispatch site the F1 work touched. */
function dispatch(frame: any) {
	(orchestratorSocket as any).handleMessage(frame);
}

beforeEach(() => {
	harness.serverProjects = [];
	harness.projects = [];
	harness.pluginError = '';
});

describe('W2 — server-to-client frames have handlers', () => {
	test('PROJECT_CREATED upserts the project so it appears without a reload', () => {
		dispatch({ type: 'PROJECT_CREATED', project: { id: '111x', name: 'Alpha' } });
		expect(harness.serverProjects.map((p) => p.id)).toContain('111x');
		expect(harness.projects).toContain('Alpha');
	});

	test('PROJECT_CREATED updates an existing project instead of duplicating it', () => {
		dispatch({ type: 'PROJECT_CREATED', project: { id: '111x', name: 'Alpha' } });
		dispatch({ type: 'PROJECT_CREATED', project: { id: '111x', name: 'Alpha Renamed' } });
		expect(harness.serverProjects.filter((p) => p.id === '111x')).toHaveLength(1);
		expect(harness.serverProjects[0].name).toBe('Alpha Renamed');
		expect(harness.projects).toEqual(['Alpha Renamed']);
	});

	test('SETTINGS_UPDATED re-applies the changed key through the SETTINGS_LOADED path', () => {
		dispatch({ type: 'SETTINGS_UPDATED', settings: { overlay_response_duration: '42' } });
		expect(harness.settings.overlayResponseDuration).toBe(42);
	});

	test('ERROR is surfaced on the rendered error slot, not dropped', () => {
		dispatch({ type: 'ERROR', message: 'Unknown event type: FOO' });
		expect(harness.pluginError).toBe('Unknown event type: FOO');
	});

	test('an unknown server frame stays harmless (no throw, no state change)', () => {
		dispatch({ type: 'SOMETHING_NEW', payload: 1 });
		expect(harness.serverProjects).toEqual([]);
		expect(harness.pluginError).toBe('');
	});
});
