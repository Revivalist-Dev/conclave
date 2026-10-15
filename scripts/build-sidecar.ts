#!/usr/bin/env bun
/**
 * Compiles sidecar binaries for the Tauri desktop bundle:
 * 1. Orchestrator binary (JS + Bun runtime embedded) -> binaries/orchestrator-<target-triple>
 * 2. Native Rust MCP CLI bridge (zero runtime dependencies) -> binaries/conclave-mcp-<target-triple>
 *
 * Runs at BUILD TIME only (root `bun run build` / `build:sidecar`).
 */
import { join } from 'node:path';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';

const rootDir = join(import.meta.dir, '..');
const src = join(rootDir, 'orchestrator', 'src', 'index.ts');
const mcpSrc = join(rootDir, 'crates', 'conclave-mcp', 'src', 'main.rs');
const outDir = join(rootDir, 'client', 'tauri', 'src-tauri', 'binaries');

if (!existsSync(outDir)) {
	mkdirSync(outDir, { recursive: true });
}

function hostTriple(): string {
	const res = Bun.spawnSync(['rustc', '-Vv'], { stdout: 'pipe', stderr: 'pipe' });
	const line = new TextDecoder()
		.decode(res.stdout)
		.split('\n')
		.find((l) => l.startsWith('host:'));
	if (!line) {
		throw new Error('Could not detect the rustc host triple; set SIDECAR_TRIPLE=<triple>');
	}
	return line.split(' ')[1].trim();
}

const triple = process.env.SIDECAR_TRIPLE || hostTriple();
const orchestratorOutfile = join(outDir, `orchestrator-${triple}`);
const mcpOutfile = join(outDir, `conclave-mcp-${triple}`);
const localMcpBin = join(rootDir, 'crates', 'conclave-mcp', 'conclave-mcp');

// 1. Compile orchestrator
console.log(`[build-sidecar] Compiling orchestrator -> ${orchestratorOutfile}`);
const proc = Bun.spawnSync({
	cmd: ['bun', 'build', '--compile', src, '--outfile', orchestratorOutfile],
	cwd: rootDir,
	stdio: ['inherit', 'inherit', 'inherit']
});
if (proc.exitCode !== 0) {
	console.error(`[build-sidecar] Orchestrator compilation failed with exit code ${proc.exitCode}`);
	process.exit(proc.exitCode ?? 1);
}

// 2. Compile native Rust MCP bridge
console.log(`[build-sidecar] Compiling native Rust MCP bridge -> ${mcpOutfile}`);
const mcpProc = Bun.spawnSync({
	cmd: ['rustc', '-O', mcpSrc, '-o', mcpOutfile],
	cwd: rootDir,
	stdio: ['inherit', 'inherit', 'inherit']
});
if (mcpProc.exitCode !== 0) {
	console.error(`[build-sidecar] Native MCP bridge compilation failed with exit code ${mcpProc.exitCode}`);
	process.exit(mcpProc.exitCode ?? 1);
}

// Keep local dev binary in sync
try {
	copyFileSync(mcpOutfile, localMcpBin);
} catch {}

// 3. Best-effort copy to /Applications/Conclave.app if installed
const appBundleDir = '/Applications/Conclave.app';
if (existsSync(appBundleDir)) {
	try {
		const appMacOsDir = join(appBundleDir, 'Contents', 'MacOS');
		const appResDir = join(appBundleDir, 'Contents', 'Resources', 'orchestrator', 'bin');
		if (existsSync(appMacOsDir)) {
			copyFileSync(mcpOutfile, join(appMacOsDir, 'conclave-mcp'));
		}
		if (!existsSync(appResDir)) {
			mkdirSync(appResDir, { recursive: true });
		}
		const jsBridgeSrc = join(rootDir, 'orchestrator', 'bin', 'mcp-server.js');
		copyFileSync(jsBridgeSrc, join(appResDir, 'mcp-server.js'));
		console.log('[build-sidecar] Synced MCP binaries into /Applications/Conclave.app');
	} catch (e: any) {
		console.log(`[build-sidecar] Note: could not write to ${appBundleDir} (${e.message})`);
	}
}

console.log('[build-sidecar] Done — all sidecars compiled.');
