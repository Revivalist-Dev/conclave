import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { IMAGE_SETTING } from '../bootstrap/pin';
import { db, repos } from '../db';
import { imageIdFromComposeImages, parseComposeJson } from './compose';
import { dedupeInFlight } from './inflight';

export interface ManagedService {
	name: string;
	directory: string;
	port: number;
	process: ChildProcess | null;
	status: 'stopped' | 'starting' | 'running' | 'failed';
	type: 'docker';
	error?: string;
	entrypoint?: string;
}

export class ServiceSupervisor {
	private services: Map<string, ManagedService> = new Map();
	// One entry per service name while a start is in flight; a second caller
	// awaits that promise instead of running a second `docker compose up -d`.
	private inFlight: Map<string, Promise<void>> = new Map();
	private sandboxDir: string;

	constructor() {
		if (process.env.CONCLAVE_DATA_DIR) {
			// Production sidecar: no sandbox next to the read-only bundle; the
			// local Docker provider simply reports as unavailable.
			this.sandboxDir = process.env.CONCLAVE_DATA_DIR;
		} else {
			// Prefer root level sandbox_api or api_sandbox
			const rootSandboxApi = join(import.meta.dir, '../../../sandbox_api');
			const rootApiSandbox = join(import.meta.dir, '../../../api_sandbox');
			if (existsSync(rootSandboxApi)) {
				this.sandboxDir = rootSandboxApi;
			} else if (existsSync(rootApiSandbox)) {
				this.sandboxDir = rootApiSandbox;
			} else {
				this.sandboxDir = join(import.meta.dir, '../../sandbox_api');
			}
		}

		// DanyAPI: runs in Docker container on localhost:8000
		this.services.set('DanyAPI', {
			name: 'DanyAPI',
			directory: join(this.sandboxDir, 'DanyAPI'),
			port: 8000,
			process: null,
			status: 'stopped',
			type: 'docker'
		});
	}

	public isDockerRunning(): boolean {
		try {
			const check = spawnSync('docker', ['info'], {
				encoding: 'utf-8',
				timeout: 5000,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			return check.status === 0;
		} catch {
			return false;
		}
	}

	public async startAll() {
		console.log('[Supervisor] Initializing LLM services (Docker containers)...');
		const dockerActive = this.isDockerRunning();
		if (dockerActive) {
			console.log('[Supervisor] Docker daemon is running.');
		} else {
			console.warn('[Supervisor] Docker daemon is not active. Attempting to launch Docker Desktop...');
			try {
				spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' });
			} catch {}
		}

		for (const [name] of this.services) {
			try {
				await this.startService(name);
			} catch (err: any) {
				// startService is expected to contain its own failures; anything that
				// escapes it is a defect in that guard, and whoever handles this
				// rejection needs to know which service it was.
				throw new Error(`${name}: ${err?.message || err}`);
			}
		}
	}

	/**
	 * Idempotent, concurrency-safe start. Two independent boot paths ask for the
	 * same service — `startAll()` above and `PluginManager.startPlugin`'s docker
	 * branch — and with no shared state both would see a dead port and both would
	 * run `docker compose up -d`, the second recreating the container while the
	 * first is still being health-polled. The in-flight map makes the later caller
	 * await the first call's result; the `running` check makes a later caller that
	 * arrives after the first has settled a no-op.
	 */
	public startService(name: string): Promise<void> {
		return dedupeInFlight(this.inFlight, name, () => this.startServiceOnce(name));
	}

	private async startServiceOnce(name: string) {
		const service = this.services.get(name);
		if (!service) return;

		// Check if service is enabled in settings
		if (name === 'DanyAPI' && !repos.isDeepSeekEnabled()) {
			console.log(`[Supervisor] ${name} (DeepSeek/Qwen) is disabled in settings. Skipping.`);
			service.status = 'stopped';
			this.recordState(service);
			return;
		}

		// Already verified up this boot: satisfied, do not re-issue compose.
		if (service.status === 'running') {
			return;
		}

		// Fast path: something already serves the port (started manually, by a
		// plugin scaffold, or from another checkout) — no local directory needed.
		if (await this.pingService(service.port)) {
			service.status = 'running';
			console.log(`[Supervisor] ${name} is already running and healthy on http://127.0.0.1:${service.port}`);
			this.recordState(service);
			if (existsSync(service.directory)) {
				this.attachLogStreamer(service);
			}
			return;
		}

		if (!existsSync(service.directory)) {
			service.status = 'failed';
			service.error = `Directory ${service.directory} does not exist`;
			this.recordState(service);
			return;
		}

		await this.startDockerService(service);
	}

	private async startDockerService(service: ManagedService) {
		// 1. Fast check: is it already running and healthy?
		const alreadyHealthy = await this.pingService(service.port);
		if (alreadyHealthy) {
			service.status = 'running';
			console.log(`[Supervisor] ${service.name} is already running and healthy on http://127.0.0.1:${service.port}`);
			this.attachLogStreamer(service);
			this.recordState(service);
			return;
		}

		// 2. Check Docker daemon availability
		if (!this.isDockerRunning()) {
			service.status = 'failed';
			service.error = 'Docker daemon is not running. Please start Docker Desktop.';
			console.error(`[Supervisor] Cannot start ${service.name}: Docker daemon is not running.`);
			this.recordState(service);
			return;
		}

		console.log(`[Supervisor] Starting ${service.name} container via docker compose...`);
		service.status = 'starting';

		try {
			// 3. Run docker compose up -d
			const upRes = spawnSync('docker', ['compose', 'up', '-d'], {
				cwd: service.directory,
				encoding: 'utf-8',
				timeout: 30000
			});

			if (upRes.status !== 0) {
				const errMsg = upRes.stderr?.trim() || upRes.stdout?.trim() || 'Docker compose up failed';
				// A non-zero `up` is not by itself proof the container is down —
				// an older container can still be serving — so ask the daemon before
				// deciding. If it cannot confirm one, fail here rather than falling
				// through to a health poll that would claim `running` regardless.
				if (!this.isContainerUp(service)) {
					service.status = 'failed';
					service.error = `docker compose up failed: ${errMsg}`;
					console.warn(`[Supervisor] ${service.name} docker compose up failed: ${errMsg}`);
					this.recordState(service);
					return;
				}
				console.warn(`[Supervisor] ${service.name} docker compose up reported an error (${errMsg}) but the daemon reports a running container; continuing.`);
			} else {
				console.log(`[Supervisor] ${service.name} docker container started.`);
			}

			// 4. Attach log streamer
			this.attachLogStreamer(service);

			// 5. Poll health ping localhost:8000/v1/models (up to 10 seconds)
			let isHealthy = false;
			for (let i = 0; i < 10; i++) {
				isHealthy = await this.pingService(service.port);
				if (isHealthy) break;
				await new Promise((r) => setTimeout(r, 1000));
			}

			if (isHealthy) {
				service.status = 'running';
				console.log(`[Supervisor] ${service.name} (DeepSeek/Qwen) verified healthy on http://127.0.0.1:${service.port}`);
			} else {
				// Three states: only a positive report may become `running`, and
				// only a negative one may be described as the daemon's answer.
				const state = this.containerState(service);
				if (state === 'up') {
					// Verified with the daemon, not assumed: the container is up and the
					// HTTP probe simply has not answered yet — the proxy is warming up.
					service.status = 'running';
					console.log(`[Supervisor] ${service.name} container is up (docker compose ps); warming up.`);
				} else {
					service.status = 'failed';
					service.error = state === 'unknown'
						? 'Health probe never answered and the container state could not be verified (docker compose ps did not answer)'
						: 'Health probe never answered and docker compose ps reports no running container';
					console.warn(`[Supervisor] ${service.name} did not become healthy and the container state is ${state}.`);
				}
			}
			this.recordState(service);
		} catch (err: any) {
			service.status = 'failed';
			service.error = err.message;
			console.error(`[Supervisor] Failed to manage ${service.name} in Docker: ${err.message}`);
			this.recordState(service);
		}
	}

	private attachLogStreamer(service: ManagedService) {
		if (service.process) {
			try {
				service.process.kill();
			} catch {}
			service.process = null;
		}

		try {
			const logProc = spawn('docker', ['compose', 'logs', '-f', '--tail', '0'], {
				cwd: service.directory,
				stdio: ['ignore', 'pipe', 'pipe']
			});

			logProc.stdout?.on('data', (data) => {
				const lines = data.toString().split('\n');
				for (const line of lines) {
					if (line.trim()) {
						console.log(`[${service.name}] ${line.trim()}`);
					}
				}
			});

			logProc.stderr?.on('data', (data) => {
				const lines = data.toString().split('\n');
				for (const line of lines) {
					if (line.trim()) {
						console.warn(`[${service.name}] ${line.trim()}`);
					}
				}
			});

			logProc.on('close', (code) => {
				if (service.status === 'running') {
					console.log(`[${service.name}] Log streamer closed with code ${code}`);
				}
			});

			service.process = logProc;
		} catch (err: any) {
			console.warn(`[Supervisor] Could not attach log streamer to ${service.name}: ${err.message}`);
		}
	}

	private async pingService(port: number): Promise<boolean> {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
				headers: { 'Host': 'localhost' },
				signal: AbortSignal.timeout(2000)
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Ask the daemon whether this service actually has a running container.
	 * `docker compose up -d` can return non-zero while an older container is
	 * still up, and it can return zero for a container that has already exited,
	 * so the health probe's silence alone cannot distinguish "warming up" from
	 * "not there". This is the check that makes the `running` claim honest.
	 *
	 * Three states, not two, because "the daemon said no" and "we could not ask"
	 * are different answers and only the first may be reported as a failure.
	 *
	 * **The retry is load-bearing, not defensive.** On Bun 1.3.14
	 * `spawnSync(..., { timeout: N })` returns `status: null` with
	 * `error.code === 'ETIMEDOUT'` after ~5 ms — the child never runs — whenever
	 * the process has been idle in async work for at least N ms. Measured
	 * directly: a 300 ms and a 5 s idle gap with `timeout: 10000` both succeed;
	 * an 11 s gap fails instantly; a 35 s gap with `timeout: 30000` fails
	 * likewise. This probe runs at the end of a 10 s health poll, so it sat
	 * exactly inside that window and reported every healthy container as absent.
	 * A spurious failure costs ~5 ms and needs a fresh idle window, so one
	 * immediate retry clears it; a real hang is still bounded by the timeout.
	 */
	private containerState(service: ManagedService): 'up' | 'down' | 'unknown' {
		const ps = (): { ok: boolean; stdout: string; detail: string } => {
			const psRes = spawnSync('docker', ['compose', 'ps', '--format', 'json'], {
				cwd: service.directory,
				encoding: 'utf-8',
				timeout: 10000
			});
			if (psRes.error || psRes.status === null) {
				return { ok: false, stdout: '', detail: psRes.error?.message || 'no exit status' };
			}
			if (psRes.status !== 0) {
				return { ok: false, stdout: '', detail: (psRes.stderr || '').trim() || `exit ${psRes.status}` };
			}
			return { ok: true, stdout: (psRes.stdout || '').trim(), detail: '' };
		};

		try {
			let result = ps();
			// See the note above: a spawn error here is usually the Bun timeout
			// trap, and it reproduces only after an idle gap, so retrying is what
			// distinguishes "the daemon is unreachable" from "the probe misfired".
			if (!result.ok) result = ps();
			if (!result.ok) {
				console.warn(`[Supervisor] ${service.name} container state could not be read: ${result.detail}`);
				return 'unknown';
			}
			if (!result.stdout) return 'down';

			// Modern Compose prints one JSON array; older versions print one JSON
			// object per line. `parseComposeJson` accepts either rather than
			// depending on the version.
			const entries = parseComposeJson(result.stdout);

			return entries.some((entry) => {
				const state = String(entry?.State ?? '').toLowerCase();
				const status = String(entry?.Status ?? '').toLowerCase();
				return state === 'running' || status.startsWith('up');
			})
				? 'up'
				: 'down';
		} catch (err: any) {
			console.warn(`[Supervisor] ${service.name} container state could not be read: ${err?.message || err}`);
			return 'unknown';
		}
	}

	/** True only when the daemon positively reported a running container. */
	private isContainerUp(service: ManagedService): boolean {
		return this.containerState(service) === 'up';
	}

	public stopAll() {
		console.log('[Supervisor] Stopping service followers...');
		for (const [_, service] of this.services) {
			if (service.process) {
				service.process.kill();
				service.process = null;
				service.status = 'stopped';
				this.recordState(service);
			}
		}
	}

	public getStatus() {
		const list: any[] = [];
		for (const [name, service] of this.services) {
			list.push({
				name,
				port: service.port,
				status: service.status,
				type: service.type,
				entrypoint: service.entrypoint || null,
				error: service.error || null
			});
		}
		return list;
	}

	private recordState(service: ManagedService) {
		const now = Date.now();
		db.prepare(
			'INSERT OR REPLACE INTO service_state (name, port, status, last_ping, error) VALUES (?, ?, ?, ?, ?)'
		).run(service.name, service.port, service.status, now, service.error || null);
		// Every transition into `running` is also the moment the running image
		// becomes worth recording, and this is the one place they all pass through.
		if (service.status === 'running') void this.recordImageId(service);
	}

	/**
	 * Record which image the running container was built from, so "which image is
	 * running" is answerable from `GET /api/settings` rather than from memory.
	 *
	 * Deliberately not awaited: the boot path must not wait on a second docker
	 * invocation for a key that is only ever inspected. A failure costs an
	 * inspectable value, not a healthy service, so it warns and stops there.
	 * `spawn` rather than `spawnSync` sidesteps the Bun 1.3.14 timed-`spawnSync`
	 * trap documented on `containerState` above, and this runs at the very end of
	 * a boot that has already been idle for seconds — exactly where it fires.
	 */
	private async recordImageId(service: ManagedService): Promise<void> {
		try {
			const imageId = await this.dockerComposeImageId(service);
			if (!imageId) return;
			repos.setSetting(IMAGE_SETTING, imageId);
		} catch (err: any) {
			console.warn(`[Supervisor] Could not record the ${service.name} image id: ${err?.message || err}`);
		}
	}

	/** `docker compose images --format json` for this service, or null. */
	private dockerComposeImageId(service: ManagedService): Promise<string | null> {
		return new Promise((resolve) => {
			let stdout = '';
			let settled = false;
			const finish = (value: string | null) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};

			try {
				const proc = spawn('docker', ['compose', 'images', '--format', 'json'], {
					cwd: service.directory,
					stdio: ['ignore', 'pipe', 'ignore']
				});

				const timer = setTimeout(() => {
					try {
						proc.kill();
					} catch {}
					finish(null);
				}, 15000);

				proc.stdout?.on('data', (data) => {
					stdout += data.toString();
				});
				proc.on('error', () => {
					clearTimeout(timer);
					finish(null);
				});
				proc.on('close', (code) => {
					clearTimeout(timer);
					if (code !== 0) return finish(null);
					// A parse failure is named rather than swallowed: the alternative
					// is a settings key that stays empty with no explanation.
					try {
						finish(imageIdFromComposeImages(stdout));
					} catch (err: any) {
						console.warn(`[Supervisor] Could not parse docker compose images output: ${err?.message || err}`);
						finish(null);
					}
				});
			} catch {
				finish(null);
			}
		});
	}
}

export const supervisor = new ServiceSupervisor();
