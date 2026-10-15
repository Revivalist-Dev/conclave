import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assessDanyApi } from '../src/bootstrap/ready';

// A temp sandbox per case; nothing here opens the database (this module imports
// only fs/path), so CONCLAVE_DATA_DIR is never involved and orchestrator/data is
// never created.
const created: string[] = [];

function tempSandbox(): string {
	const dir = mkdtempSync(join(tmpdir(), 'conclave-ready-'));
	created.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of created) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

describe('assessDanyApi', () => {
	test('an empty directory is not ready and reports why', () => {
		const dir = tempSandbox();

		const result = assessDanyApi(dir);

		expect(result.ready).toBe(false);
		expect(result.error).toBeTruthy();
		expect(result.error).toContain('DanyAPI');
	});

	test('a Dockerfile-only stub is not ready', () => {
		const dir = tempSandbox();
		mkdirSync(join(dir, 'DanyAPI'), { recursive: true });
		writeFileSync(join(dir, 'DanyAPI', 'Dockerfile'), 'FROM scratch\n');

		const result = assessDanyApi(dir);

		expect(result.ready).toBe(false);
		expect(result.error).toContain('docker-compose.yml');
	});

	test('a source tree plus a compose file is ready with a null error', () => {
		const dir = tempSandbox();
		mkdirSync(join(dir, 'DanyAPI'), { recursive: true });
		writeFileSync(join(dir, 'DanyAPI', 'docker-compose.yml'), 'services: {}\n');

		const result = assessDanyApi(dir);

		expect(result.ready).toBe(true);
		expect(result.error).toBe(null);
	});

	test('a compose file with no source tree is not ready and names the missing tree', () => {
		const dir = tempSandbox();
		writeFileSync(join(dir, 'docker-compose.yml'), 'services: {}\n');

		const result = assessDanyApi(dir);

		expect(result.ready).toBe(false);
		expect(result.error).toBeTruthy();
		expect(result.error).toContain('source tree');
		expect(result.error).toContain(join(dir, 'DanyAPI'));
	});
});
