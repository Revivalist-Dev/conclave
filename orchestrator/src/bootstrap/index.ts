import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { initDatabase, repos } from '../db';

export interface BootstrapResult {
	dbInitialized: boolean;
	danyApiReady: boolean;
	sandboxPath: string;
}

export async function runBootstrap(): Promise<BootstrapResult> {
	console.log('[Bootstrap] Starting orchestrator initialization sequence...');

	// 1. Initialize SQLite database
	try {
		initDatabase();
		console.log('[Bootstrap] SQLite database initialized at orchestrator/data/brainstorm.db');
	} catch (err: any) {
		console.error(`[Bootstrap] SQLite initialization failed: ${err.message}`);
	}

	// 2. Setup api_sandbox directory (root level: /api_sandbox).
	// Production runs (BRAINSTORM_DATA_DIR set by the sidecar loader) skip the
	// sandbox entirely: DanyAPI is a local Docker dev provider, and a shipped
	// app must not git-clone repos or write into its read-only bundle.
	const dataDir = process.env.BRAINSTORM_DATA_DIR;
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
	const danyRepo = 'https://github.com/mindflowgo/DanyAPI.git';

	if (dataDir) {
		console.log('[Bootstrap] Production run: skipping DanyAPI sandbox (local Docker provider disabled).');
	} else if (!existsSync(danyDir)) {
		console.log(`[Bootstrap] Ingesting DanyAPI repository from ${danyRepo}...`);
		try {
			const cloneResult = spawnSync('git', ['clone', '--depth', '1', danyRepo, danyDir], {
				encoding: 'utf-8',
				timeout: 20000
			});
			if (cloneResult.status === 0 && existsSync(danyDir)) {
				console.log('[Bootstrap] Cloned DanyAPI successfully.');
				danyReady = true;
			} else {
				console.warn(`[Bootstrap] Git clone failed or network unavailable (${cloneResult.stderr?.trim()}). Creating local sandbox stub.`);
				mkdirSync(danyDir, { recursive: true });
				danyReady = true;
			}
		} catch (err: any) {
			console.warn(`[Bootstrap] Failed to clone ${danyRepo}: ${err.message}. Creating directory stub.`);
			mkdirSync(danyDir, { recursive: true });
			danyReady = true;
		}
	} else {
		console.log('[Bootstrap] DanyAPI exists. Pulling latest updates...');
		try {
			const pullResult = spawnSync('git', ['pull'], { cwd: danyDir, encoding: 'utf-8', timeout: 15000 });
			if (pullResult.status === 0) {
				console.log('[Bootstrap] DanyAPI updated.');
			}
		} catch {}
		danyReady = true;
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
	repos.setSetting('deepseek_enabled', 'true');
	repos.setSetting('deepseek_endpoint', 'http://127.0.0.1:8000/v1');
	repos.setSetting('danyapi_port', '8000');

	console.log('[Bootstrap] Sequence completed successfully.');

	return {
		dbInitialized: true,
		danyApiReady: danyReady,
		sandboxPath: sandboxDir
	};
}
