import { describe, expect, test } from 'bun:test';
import {
	MAX_DIAGNOSTIC_LEN,
	sanitizeDiagnostic,
	redactPaths,
	redactServiceErrors,
	publicBootstrap
} from '../src/surface';

describe('sanitizeDiagnostic', () => {
	test('collapses a newline so a forged payload stays on one line', () => {
		const forged = 'first line\n[Upload] Saved file';
		const out = sanitizeDiagnostic(forged);
		expect(out).not.toContain('\n');
		expect(out).toBe('first line\\n[Upload] Saved file');
	});

	test('clips an over-length value and names the dropped character count', () => {
		const over = 'x'.repeat(MAX_DIAGNOSTIC_LEN + 100);
		const out = sanitizeDiagnostic(over);
		expect(out.length).toBeLessThan(over.length);
		expect(out.startsWith('x'.repeat(MAX_DIAGNOSTIC_LEN))).toBe(true);
		expect(out).toContain('100');
	});

	test("returns '' for null and ''", () => {
		expect(sanitizeDiagnostic(null)).toBe('');
		expect(sanitizeDiagnostic('')).toBe('');
	});
});

describe('publicBootstrap', () => {
	const path = 'C:\\Users\\someone\\AppData\\Roaming\\dev.revivalist.conclave';

	test('carries no absolute path', () => {
		const json = JSON.stringify(
			publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: path })
		);
		expect(json).not.toContain('AppData');
		expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
	});

	test('sandboxId is 12 lowercase hex chars and stable across calls', () => {
		const first = publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: path });
		const second = publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: path });
		expect(first.sandboxId).toMatch(/^[0-9a-f]{12}$/);
		expect(first.sandboxId).toBe(second.sandboxId);
		expect(first.sandboxConfigured).toBe(true);
	});

	test('a different path yields a different id', () => {
		const a = publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: path });
		const b = publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: 'D:\\sandbox' });
		expect(a.sandboxId).not.toBe(b.sandboxId);
	});

	test('a path-bearing danyError is redacted before it reaches the surface', () => {
		const projected = publicBootstrap({
			dbInitialized: true,
			danyApiReady: false,
			danyError: `DanyAPI clone failed: fatal: could not create work tree dir '${path}\\DanyAPI'`,
			sandboxPath: path
		});

		const json = JSON.stringify(projected);
		expect(json).not.toContain('AppData');
		expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
		expect(projected.danyError).toContain('<path>');
		expect(projected.danyError).toContain('DanyAPI clone failed');
	});

	test('a null danyError stays null', () => {
		const projected = publicBootstrap({ dbInitialized: true, danyApiReady: true, danyError: null, sandboxPath: path });
		expect(projected.danyError).toBe(null);
	});
});

describe('redactPaths', () => {
	test('replaces a Windows absolute path', () => {
		const out = redactPaths('Directory C:\\Users\\someone\\AppData\\Local\\Temp\\p\\DanyAPI does not exist');
		expect(out).not.toMatch(/[A-Za-z]:\\/);
		expect(out).toContain('<path>');
		expect(out).toContain('does not exist');
	});

	test('replaces a POSIX absolute path under a home or temp root', () => {
		const out = redactPaths('no such file: /home/ci/conclave/api_sandbox/DanyAPI');
		expect(out).not.toContain('/home/ci');
		expect(out).toBe('no such file: <path>');
	});

	test("returns '' for an empty message", () => {
		expect(redactPaths('')).toBe('');
	});
});

describe('redactServiceErrors', () => {
	const services = [
		{ name: 'DanyAPI', port: 8000, status: 'failed', error: 'Directory C:\\work\\sbx\\DanyAPI does not exist' },
		{ name: 'DeepSeek', port: 8001, status: 'running', error: null }
	];

	test('a path-bearing error is redacted while the rest of the row survives', () => {
		const [failed, healthy] = redactServiceErrors(services);
		expect(JSON.stringify(failed)).not.toMatch(/[A-Za-z]:\\/);
		expect(failed.status).toBe('failed');
		expect(failed.port).toBe(8000);
		expect(healthy.error).toBe(null);
		expect(healthy.status).toBe('running');
	});

	test('the input list is not mutated', () => {
		redactServiceErrors(services);
		expect(services[0].error).toContain('C:\\work');
	});
});
