import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { db, repos } from '../db';

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
			await this.startService(name);
		}
	}

	public async startService(name: string) {
		const service = this.services.get(name);
		if (!service) return;

		// Check if service is enabled in settings
		if (name === 'DanyAPI' && !repos.isDeepSeekEnabled()) {
			console.log(`[Supervisor] ${name} (DeepSeek/Qwen) is disabled in settings. Skipping.`);
			service.status = 'stopped';
			this.recordState(service);
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
				console.warn(`[Supervisor] ${service.name} docker compose up warning: ${errMsg}`);
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
				service.status = 'running'; // Container is up, proxy still warming up
				console.log(`[Supervisor] ${service.name} container is running; warming up.`);
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
	}
}

export const supervisor = new ServiceSupervisor();
