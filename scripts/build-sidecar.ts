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
// On Windows both `bun build --compile` and `tauri-build` require the `.exe`
// suffix, and bare `rustc -o <name>` writes the name literally given — so the
// suffix has to be attached here or the Tauri resource lookup misses the file.
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const orchestratorOutfile = join(outDir, `orchestrator-${triple}${exeSuffix}`);
const mcpOutfile = join(outDir, `conclave-mcp-${triple}${exeSuffix}`);
const localMcpBin = join(rootDir, 'crates', 'conclave-mcp', `conclave-mcp${exeSuffix}`);

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

// Keep local dev binary in sync. This is a convenience copy, not a build
// product, so a failure warns loudly and the build continues — but it must never
// be silent, because a swallow here hides a real misconfiguration (a missing
// directory, a locked file) with no trace at all.
try {
	mkdirSync(join(rootDir, 'crates', 'conclave-mcp'), { recursive: true });
	copyFileSync(mcpOutfile, localMcpBin);
	console.log(`[build-sidecar] Synced local dev bridge -> ${localMcpBin}`);
} catch (e: any) {
	console.warn(
		`[build-sidecar] WARNING: could not copy ${mcpOutfile} -> ${localMcpBin}: ${e?.message ?? e}`
	);
}

console.log('[build-sidecar] Done — all sidecars compiled.');
