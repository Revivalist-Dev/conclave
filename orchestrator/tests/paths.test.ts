import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isConfined } from '../src/mcp/paths';

/**
 * Fixtures live under the OS temp directory, never the repo: importing this module
 * must not create orchestrator/data/ or conclave.db. That is why paths.ts imports
 * only path and fs, and why the test imports only paths.ts.
 */
const base = mkdtempSync(join(tmpdir(), 'conclave-paths-'));
const root = join(base, 'conclave');
const sibling = join(base, 'conclave-backup');
const outside = join(base, 'outside');

mkdirSync(root, { recursive: true });
mkdirSync(sibling, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(root, 'inside.txt'), 'inside');
writeFileSync(join(sibling, 'secrets.env'), 'secrets');
writeFileSync(join(outside, 'secret.txt'), 'outside');

// A junction needs no elevation on Windows and realpathSync still resolves it.
const link = join(root, 'escape-link');
symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

describe('isConfined', () => {
	test('denies a sibling directory that shares the root as a text prefix', () => {
		// The pre-fix check allowed this: `C:\work\conclave-backup` starts with `C:\work\conclave`.
		expect(isConfined(root, join('..', 'conclave-backup', 'secrets.env'))).toBe(false);
	});

	test('allows a file genuinely inside the root', () => {
		expect(isConfined(root, 'inside.txt')).toBe(true);
		expect(isConfined(root, join(root, 'inside.txt'))).toBe(true);
	});

	test('allows a path equal to the root itself', () => {
		expect(isConfined(root, root)).toBe(true);
		expect(isConfined(root, '.')).toBe(true);
	});

	// Runs only on Windows, where the pre-fix comparison refused a differently-cased
	// root. On any other platform the arm is reported as skipped by test.if, never passed.
	test.if(process.platform === 'win32')(
		'allows a differently-cased root on Windows',
		() => {
			expect(isConfined(root.toUpperCase(), join(root, 'inside.txt'))).toBe(true);
		}
	);

	test('denies a symlink inside the root that points outside it', () => {
		expect(isConfined(root, join('escape-link', 'secret.txt'))).toBe(false);
		expect(isConfined(root, join('escape-link', 'not-created.txt'))).toBe(false);
	});

	test('allows a not-yet-existing write target whose parent is inside the root', () => {
		// `sub` does not exist either, so the nearest existing ancestor is the root.
		expect(isConfined(root, join('sub', 'new-file.txt'))).toBe(true);
	});

	test('denies a not-yet-existing write target whose parent escapes', () => {
		expect(isConfined(root, join('..', 'conclave-backup', 'new-file.txt'))).toBe(false);
		expect(isConfined(root, join('..', 'never-created', 'new-file.txt'))).toBe(false);
	});
});
