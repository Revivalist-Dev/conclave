import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { initDatabase, repos, DATA_DIR } from '../db';
import { DEFAULT_PROVIDER_ENDPOINT } from '../providers/endpoint';
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
	const danyRepo = 'https://github.com/mindflowgo/DanyAPI.git';
	let danyReady = false;
	let danyError: string | null = null;

	if (dataDir) {
		// Production deliberately skips the sandbox: no clone, no compose file.
		// The honest report is "not ready", with the reason recorded.
		console.log('[Bootstrap] Production run: skipping DanyAPI sandbox (local Docker provider disabled).');
		danyError = 'Production run: DanyAPI sandbox is disabled (CONCLAVE_DATA_DIR is set).';
	} else if (!existsSync(danyDir)) {
		console.log(`[Bootstrap] Ingesting DanyAPI repository from ${danyRepo}...`);
		try {
			const cloneResult = spawnSync('git', ['clone', '--depth', '1', danyRepo, danyDir], {
				encoding: 'utf-8',
				timeout: 20000
			});
			if (cloneResult.status === 0 && existsSync(danyDir)) {
				console.log('[Bootstrap] Cloned DanyAPI successfully.');
			} else {
				const reason = cloneResult.stderr?.trim() || `git clone exited with status ${cloneResult.status}`;
				console.warn(`[Bootstrap] Git clone failed or network unavailable (${reason}). Creating local sandbox stub.`);
				danyError = `DanyAPI clone failed: ${reason}`;
				mkdirSync(danyDir, { recursive: true });
			}
		} catch (err: any) {
			console.warn(`[Bootstrap] Failed to clone ${danyRepo}: ${err.message}. Creating directory stub.`);
			danyError = `DanyAPI clone failed: ${err.message}`;
			mkdirSync(danyDir, { recursive: true });
		}
	} else {
		console.log('[Bootstrap] DanyAPI exists. Pulling latest updates...');
		try {
			const pullResult = spawnSync('git', ['pull'], { cwd: danyDir, encoding: 'utf-8', timeout: 15000 });
			if (pullResult.status === 0) {
				console.log('[Bootstrap] DanyAPI updated.');
			}
		} catch {}
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
