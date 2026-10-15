import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { initDatabase, repos, DATA_DIR } from '../db';
import { DEFAULT_PROVIDER_ENDPOINT } from '../providers/endpoint';
import { composeContractError } from './compose';
import {
	DANYAPI_COMMIT,
	DANYAPI_COMMIT_SHORT,
	DANYAPI_REPO,
	checkoutArgs,
	fetchArgs,
	pinSettings,
	revParseArgs,
	vendoredBuildFiles,
	verifyHead
} from './pin';
import { assessDanyApi } from './ready';

export interface BootstrapResult {
	dbInitialized: boolean;
	danyApiReady: boolean;
	danyError: string | null;
	sandboxPath: string;
}

export async function runBootstrap(): Promise<BootstrapResult> {
	console.log('[Bootstrap] Starting orchestrator initialization sequence...');

	// 1. Initialize SQLite database
	try {
		initDatabase();
		// The path is DATA_DIR's, not a literal: in a production run CONCLAVE_DATA_DIR
		// is set and the database is written there, so the hardcoded path this line
		// used to print was false in exactly the case it mattered.
		console.log(`[Bootstrap] SQLite database initialized at ${join(DATA_DIR, 'conclave.db')}`);
	} catch (err: any) {
		console.error(`[Bootstrap] SQLite initialization failed: ${err.message}`);
	}

	// 2. Setup api_sandbox directory (root level: /api_sandbox).
	// Production runs (CONCLAVE_DATA_DIR set by the sidecar loader) skip the
	// sandbox entirely: DanyAPI is a local Docker dev provider, and a shipped
	// app must not git-clone repos or write into its read-only bundle.
	const dataDir = process.env.CONCLAVE_DATA_DIR;
	let sandboxDir: string;
	if (dataDir) {
		sandboxDir = dataDir;
	} else {
		sandboxDir = join(import.meta.dir, '../../../api_sandbox');
		if (!existsSync(sandboxDir)) {
			const localSandbox = join(import.meta.dir, '../../api_sandbox');
			if (existsSync(localSandbox)) {
				sandboxDir = localSandbox;
			} else {
				mkdirSync(sandboxDir, { recursive: true });
			}
		}
	}

	// 3. Setup DanyAPI (Docker container for self-contained LLMs) — dev only.
	const danyDir = join(sandboxDir, 'DanyAPI');
	let danyReady = false;
	let danyError: string | null = null;
	// The commit `git rev-parse HEAD` reported, or null when it could not be read.
	let danyHead: string | null = null;

	if (dataDir) {
		// Production deliberately skips the sandbox: no clone, no compose file.
		// The honest report is "not ready", with the reason recorded.
		console.log('[Bootstrap] Production run: skipping DanyAPI sandbox (local Docker provider disabled).');
		danyError = 'Production run: DanyAPI sandbox is disabled (CONCLAVE_DATA_DIR is set).';
	} else if (!existsSync(danyDir)) {
		console.log(`[Bootstrap] Ingesting DanyAPI repository from ${DANYAPI_REPO}...`);
		try {
			const cloneResult = spawnSync('git', ['clone', '--depth', '1', DANYAPI_REPO, danyDir], {
				encoding: 'utf-8',
				timeout: 20000
			});
			if (cloneResult.status === 0 && existsSync(danyDir)) {
				console.log('[Bootstrap] Cloned DanyAPI successfully.');
				// The clone lands on the default branch head, which is a moving
				// reference. The pin is applied on top of it, never instead of it.
				const pinned = pinCheckout(danyDir);
				danyHead = pinned.commit;
				if (pinned.error) danyError = pinned.error;
			} else {
				const reason = cloneResult.stderr?.trim() || `git clone exited with status ${cloneResult.status}`;
				console.warn(`[Bootstrap] Git clone failed or network unavailable (${reason}). Creating local sandbox stub.`);
				danyError = `DanyAPI clone failed: ${reason}`;
				mkdirSync(danyDir, { recursive: true });
			}
		} catch (err: any) {
			console.warn(`[Bootstrap] Failed to clone ${DANYAPI_REPO}: ${err.message}. Creating directory stub.`);
			danyError = `DanyAPI clone failed: ${err.message}`;
			mkdirSync(danyDir, { recursive: true });
		}
	} else {
		// Deliberately not `git pull`: a pull is what moved this checkout to
		// whatever the branch head had become, which is the moving reference the
		// pin replaces. Re-asserting the pin is idempotent and keeps the local
		// tree on it.
		console.log(`[Bootstrap] DanyAPI exists. Asserting the pinned commit ${DANYAPI_COMMIT_SHORT}...`);
		const pinned = pinCheckout(danyDir);
		danyHead = pinned.commit;
		if (pinned.error) danyError = pinned.error;
	}

	// 3b. Replace the build files the checkout shipped with the ones Conclave
	// owns, so the image is built from a recipe we pin rather than the fork's
	// bare `FROM python:3.14-slim` and seven unversioned packages.
	//
	// Gated on the checkout's own requirements.txt, which the vendored Dockerfile
	// COPYs: writing these files into the stub a failed clone leaves behind would
	// make `assessDanyApi` report ready for a tree that has no source in it,
	// which is exactly the lie C2 removed.
	if (!dataDir && existsSync(join(danyDir, 'requirements.txt'))) {
		const writeError = writeVendoredBuildFiles(danyDir);
		if (writeError && !danyError) danyError = writeError;
	}

	// Readiness is a property of what is on disk, not of which branch ran: a
	// failed clone leaves a stub directory and a deleted fork leaves an empty
	// one, so the clone status alone cannot answer it. Production skips the
	// assessment because it skips the sandbox.
	if (!dataDir) {
		const assessment = assessDanyApi(sandboxDir);
		danyReady = assessment.ready;
		if (!danyReady && !danyError) danyError = assessment.error;
	}

	// Setup .env and docker-compose.yml for DanyAPI — dev only
	if (!dataDir) {
		const danyEnvFile = join(danyDir, '.env');
		const danySettingsFile = join(sandboxDir, 'DanyAPI_settings');

		if (!existsSync(danyEnvFile)) {
			if (existsSync(danySettingsFile)) {
				try {
					const settingsData = readFileSync(danySettingsFile, 'utf-8');
					writeFileSync(danyEnvFile, settingsData, 'utf-8');
					console.log(`[Bootstrap] Copied ${danySettingsFile} to ${danyEnvFile}`);
				} catch {}
			} else {
				const defaultEnv = `# DanyAPI Environment Configuration
	DANYAPI_HOST=0.0.0.0
	DANYAPI_PORT=8000
	DEBUG=False
	`;
				writeFileSync(danyEnvFile, defaultEnv, 'utf-8');
				console.log(`[Bootstrap] Created default .env for DanyAPI at ${danyEnvFile}`);
			}
		}
	}

	repos.setSetting('bootstrap_last_run', Date.now().toString());

	// The pin this boot was built against, and the commit `git rev-parse` actually
	// reported. Both are written so "which code is running" is answerable from
	// `GET /api/settings` rather than from memory: an unresolvable HEAD records
	// only the pin, which is what makes "pinned but unverified" legible.
	if (!dataDir) {
		for (const [key, value] of pinSettings(danyHead, DANYAPI_COMMIT)) {
			repos.setSetting(key, value);
		}
	}

	// Seed-only, not assign: these three are user-facing configuration, and
	// writing them unconditionally on every boot resets a choice the user made
	// — a custom endpoint could not survive a restart, which made W1's per-call
	// read pointless, and `deepseek_enabled` could never be turned off. A fresh
	// database is already seeded by db/index.ts; this covers one that predates
	// the key.
	if (!repos.getSetting('deepseek_enabled')) repos.setSetting('deepseek_enabled', 'true');
	if (!repos.getSetting('deepseek_endpoint')) repos.setSetting('deepseek_endpoint', DEFAULT_PROVIDER_ENDPOINT);
	if (!repos.getSetting('danyapi_port')) repos.setSetting('danyapi_port', '8000');

	console.log('[Bootstrap] Sequence completed successfully.');

	return {
		dbInitialized: true,
		danyApiReady: danyReady,
		danyError,
		sandboxPath: sandboxDir
	};
}

/**
 * Put the checkout at the pinned commit, verify it got there, and return what
 * was observed.
 *
 * Every failure here is loud. A swallowed fetch or checkout is this tree's [K1]
 * shape, and the supply chain is the worst place for it: an unverified checkout
 * leaves the provider running whatever code the branch happened to hold, with
 * nothing in the log to say so.
 */
function pinCheckout(dir: string): { commit: string | null; error: string | null } {
	const fetchResult = spawnSync('git', fetchArgs(DANYAPI_COMMIT), { cwd: dir, encoding: 'utf-8', timeout: 20000 });
	if (fetchResult.status !== 0) {
		const reason = fetchResult.stderr?.trim() || `git fetch exited with status ${fetchResult.status}`;
		console.warn(`[Bootstrap] git fetch of the pinned commit ${DANYAPI_COMMIT_SHORT} failed: ${reason}`);
		return { commit: null, error: `DanyAPI pin fetch failed: ${reason}` };
	}

	const checkoutResult = spawnSync('git', checkoutArgs(DANYAPI_COMMIT), { cwd: dir, encoding: 'utf-8', timeout: 20000 });
	if (checkoutResult.status !== 0) {
		const reason = checkoutResult.stderr?.trim() || `git checkout exited with status ${checkoutResult.status}`;
		console.warn(`[Bootstrap] git checkout of the pinned commit ${DANYAPI_COMMIT_SHORT} failed: ${reason}`);
		return { commit: null, error: `DanyAPI pin checkout failed: ${reason}` };
	}

	const revResult = spawnSync('git', revParseArgs(), { cwd: dir, encoding: 'utf-8', timeout: 10000 });
	const head = revResult.status === 0 ? revResult.stdout?.trim() || null : null;
	const verdict = verifyHead(head, DANYAPI_COMMIT);
	if (!verdict.ok) {
		console.warn(`[Bootstrap] WARNING: ${verdict.error}`);
		return { commit: verdict.actual, error: verdict.error };
	}

	console.log(`[Bootstrap] DanyAPI is at the pinned commit ${DANYAPI_COMMIT_SHORT}.`);
	return { commit: verdict.actual, error: null };
}

/**
 * Write the build files Conclave owns over the ones the checkout shipped.
 *
 * A failure is a warning and a recorded error, never a silent skip: keeping the
 * fork's Dockerfile would leave the image built from an unpinned recipe, which
 * is the half of S1 this exists to close.
 */
function writeVendoredBuildFiles(destDir: string): string | null {
	let error: string | null = null;

	for (const file of vendoredBuildFiles(destDir)) {
		try {
			const text = readFileSync(file.source, 'utf-8');
			if (file.name === 'docker-compose.yml') {
				const contractError = composeContractError(text);
				if (contractError) {
					// Keep the checkout's own compose file. It declares the service name
					// and port the supervisor probes, and a compose file that does not is
					// worse than an unpinned one that works.
					console.warn(
						`[Bootstrap] Not writing the vendored ${file.name}: ${contractError}. Keeping the checkout's own copy.`
					);
					if (!error) error = `Vendored build file not applied: ${contractError}`;
					continue;
				}
			}
			writeFileSync(file.dest, text, 'utf-8');
			console.log(`[Bootstrap] Wrote the pinned ${file.name} to ${file.dest}`);
		} catch (err: any) {
			console.warn(`[Bootstrap] Failed to write the vendored ${file.name} to ${file.dest}: ${err?.message || err}`);
			if (!error) error = `Vendored build file ${file.name} not applied: ${err?.message || err}`;
		}
	}

	return error;
}
