/**
 * W6 — the client must not invent a project id. Both fallback sites in
 * `harness.svelte.ts` (`createConversation` and the fabricating branch of
 * `handleTabDetail`) previously stamped `'112'`; the seeded first project really
 * is `'112'` (`newProjectId(1)` → `encodeB58(1, 3)`), but a client that hardcodes
 * a server identifier is wrong on principle and breaks the moment that id differs.
 *
 * Lives in `tests/` for the same reason as `orchestratorMessageHandlers.test.ts`:
 * `tsconfig.json` includes `["src", "test", "*"]`, so a `*.test.ts` under `src/`
 * would pull `bun:test` into the `svelte-check` gate. The module under test is a
 * Svelte 5 runes module and `bun test` has no Svelte compiler, so the rune globals
 * are stubbed before the dynamic import below.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

(globalThis as any).$state = (value: any) => value;
const derivedStub: any = (fn: any) => fn();
derivedStub.by = (fn: any) => fn();
(globalThis as any).$derived = derivedStub;

const { harness } = await import('../src/lib/stores/harness.svelte.ts');

/** Replace `window` with a minimal stand-in; `send` captures frames when connected. */
function setWindow(socket: { status: string; send: (frame: any) => void } | null, sent: any[] = []) {
	(globalThis as any).window = {
		location: { pathname: '/' },
		...(socket ? { __orchestratorSocket: socket } : {})
	};
	return sent;
}

beforeEach(() => {
	harness.conversations = [];
	harness.serverProjects = [];
	harness.projects = [];
	harness.openTabIds = [];
	harness.activeConversationId = '';
});

describe('W6 — the client does not invent a project id', () => {
	test('TAB_CREATE omits projectId when the server project list has not arrived', () => {
		const sent: any[] = [];
		setWindow({ status: 'connected', send: (frame: any) => sent.push(frame) });

		harness.createConversation();

		expect(sent).toHaveLength(1);
		expect(sent[0].type).toBe('TAB_CREATE');
		// The orchestrator's TAB_CREATE case answers `payload.projectId || defaultProj?.id`,
		// so an absent field is what makes the server assign the real first project.
		expect(sent[0].projectId).toBeUndefined();
		expect(sent[0].projectId).not.toBe('112');
	});

	test('the offline path leaves project_id unset rather than stamping a fabricated id', () => {
		setWindow(null);

		const conv = harness.createConversation();

		expect(conv).toBeDefined();
		expect(conv!.project_id).toBeUndefined();
	});

	test('a known project list supplies the real first project id', () => {
		setWindow(null);
		harness.serverProjects = [{ id: '112', name: 'Discussions' } as any];

		const conv = harness.createConversation();

		expect(conv!.project_id).toBe('112');
	});

	test('handleTabDetail uses the real first project when known, and nothing otherwise', () => {
		setWindow(null);

		harness.handleTabDetail('1113', []);
		expect(harness.conversations[0].project_id).toBeUndefined();

		harness.conversations = [];
		harness.serverProjects = [{ id: '112', name: 'Discussions' } as any];
		harness.handleTabDetail('1114', []);
		expect(harness.conversations[0].project_id).toBe('112');
	});

	test('a group naming a server project still resolves to that project id', () => {
		setWindow(null);
		harness.serverProjects = [
			{ id: '112', name: 'Discussions' } as any,
			{ id: '113', name: 'Website' } as any
		];

		const conv = harness.createConversation('Website');

		expect(conv!.project_id).toBe('113');
	});
});
