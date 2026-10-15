import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
	DANYAPI_COMMIT,
	DANYAPI_COMMIT_SHORT,
	PINNED_COMMIT_SETTING,
	RESOLVED_COMMIT_SETTING,
	checkoutArgs,
	fetchArgs,
	pinSettings,
	revParseArgs,
	vendoredBuildFiles,
	verifyHead
} from '../src/bootstrap/pin';

// Nothing here opens the database: `pin.ts` imports only `path`, so these cases
// run without CONCLAVE_DATA_DIR and never create orchestrator/data.

describe('git argv', () => {
	test('the pin is a 40-character commit and its short form is the first 12', () => {
		expect(DANYAPI_COMMIT).toMatch(/^[0-9a-f]{40}$/);
		expect(DANYAPI_COMMIT_SHORT).toBe(DANYAPI_COMMIT.slice(0, 12));
	});

	test('fetch names the commit itself and never a branch', () => {
		const args = fetchArgs(DANYAPI_COMMIT);

		expect(args).toEqual(['fetch', '--depth', '1', 'origin', DANYAPI_COMMIT]);
		expect(args).not.toContain('main');
	});

	test('checkout detaches, because the target is a commit rather than a head', () => {
		expect(checkoutArgs(DANYAPI_COMMIT)).toEqual(['checkout', '--detach', DANYAPI_COMMIT]);
	});

	test('the head is read back so the pin can be verified', () => {
		expect(revParseArgs()).toEqual(['rev-parse', 'HEAD']);
	});
});

describe('verifyHead', () => {
	test('a matching head passes and reports what was observed', () => {
		const verdict = verifyHead(`  ${DANYAPI_COMMIT.toUpperCase()}\n`, DANYAPI_COMMIT);

		expect(verdict.ok).toBe(true);
		expect(verdict.actual).toBe(DANYAPI_COMMIT);
		expect(verdict.error).toBe(null);
	});

	test('a different head fails and names both sides', () => {
		const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

		const verdict = verifyHead(other, DANYAPI_COMMIT);

		expect(verdict.ok).toBe(false);
		expect(verdict.actual).toBe(other);
		expect(verdict.error).toContain(other.slice(0, 12));
		expect(verdict.error).toContain(DANYAPI_COMMIT_SHORT);
	});

	test('an unreadable head fails rather than passing quietly', () => {
		for (const head of [null, undefined, '', '   ']) {
			const verdict = verifyHead(head, DANYAPI_COMMIT);
			expect(verdict.ok).toBe(false);
			expect(verdict.actual).toBe(null);
			expect(verdict.error).toContain('unverified');
		}
	});
});

describe('pinSettings', () => {
	test('records the pin, and the resolved commit only when one was observed', () => {
		expect(pinSettings(DANYAPI_COMMIT, DANYAPI_COMMIT)).toEqual([
			[PINNED_COMMIT_SETTING, DANYAPI_COMMIT],
			[RESOLVED_COMMIT_SETTING, DANYAPI_COMMIT]
		]);
		expect(pinSettings(null, DANYAPI_COMMIT)).toEqual([[PINNED_COMMIT_SETTING, DANYAPI_COMMIT]]);
	});
});

describe('vendoredBuildFiles', () => {
	test('writes the Dockerfile last, so a partial application cannot orphan its constraints', () => {
		const files = vendoredBuildFiles(join('/sandbox', 'DanyAPI'), join('/recipe'));

		expect(files.map((f) => f.name)).toEqual(['constraints.txt', 'docker-compose.yml', 'Dockerfile']);
		expect(files.map((f) => f.dest)).toEqual(
			['constraints.txt', 'docker-compose.yml', 'Dockerfile'].map((name) => join('/sandbox', 'DanyAPI', name))
		);
		expect(files.map((f) => f.source)).toEqual(
			['constraints.txt', 'docker-compose.yml', 'Dockerfile'].map((name) => join('/recipe', name))
		);
	});
});
