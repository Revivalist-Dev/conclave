/**
 * DanyAPI readiness — a pure filesystem decision.
 *
 * This module imports only `fs`/`path` on purpose: `bootstrap/index.ts` imports
 * `../db`, so a test that reached the readiness check through it would open
 * SQLite and create the repo's `orchestrator/data/conclave.db`. Keeping the
 * decision here lets it be tested against a temp directory with nothing else
 * loaded.
 */
import { existsSync, statSync } from 'fs';
import { join } from 'path';

export interface DanyApiAssessment {
	ready: boolean;
	error: string | null;
}

/**
 * Is a runnable DanyAPI checkout present under `dir`?
 *
 * `docker compose up -d` runs with its working directory at `<dir>/DanyAPI`, so
 * readiness means the source tree is there **and** the compose file that
 * invocation consumes is at its root — a directory that merely exists is a stub,
 * not a provider.
 */
export function assessDanyApi(dir: string): DanyApiAssessment {
	const sourceDir = join(dir, 'DanyAPI');
	const composeFile = join(sourceDir, 'docker-compose.yml');

	let isSourceDir = false;
	try {
		isSourceDir = existsSync(sourceDir) && statSync(sourceDir).isDirectory();
	} catch {
		isSourceDir = false;
	}

	if (!isSourceDir) {
		return { ready: false, error: `DanyAPI source tree missing at ${sourceDir}` };
	}

	if (!existsSync(composeFile)) {
		return { ready: false, error: `docker-compose.yml missing at ${composeFile}` };
	}

	return { ready: true, error: null };
}
