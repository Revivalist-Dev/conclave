#!/usr/bin/env bun
/**
 * Compiles the orchestrator into a self-contained sidecar binary (JS + Bun
 * runtime embedded — no bun install needed on the user's machine), named the
 * way Tauri's bundle.externalBin expects: binaries/orchestrator-<target-triple>.
 *
 * Runs at BUILD TIME only (root `bun run build` / `build:sidecar`), never at
 * app runtime. Override the target with SIDECAR_TRIPLE for cross-builds.
 */
import { join } from 'node:path';

const rootDir = join(import.meta.dir, '..');
const src = join(rootDir, 'orchestrator', 'src', 'index.ts');
const outDir = join(rootDir, 'client', 'tauri', 'src-tauri', 'binaries');

function hostTriple(): string {
	const res = Bun.spawnSync(['rustc', '-Vv'], { stdout: 'pipe', stderr: 'pipe' });
	const line = new TextDecoder().decode(res.stdout)
		.split('\n')
		.find((l) => l.startsWith('host:'));
	if (!line) {
		throw new Error('Could not detect the rustc host triple; set SIDECAR_TRIPLE=<triple>');
	}
	return line.split(' ')[1].trim();
}

const triple = process.env.SIDECAR_TRIPLE || hostTriple();
const outfile = join(outDir, `orchestrator-${triple}`);

console.log(`[build-sidecar] Compiling orchestrator -> ${outfile}`);
const proc = Bun.spawnSync({
	cmd: ['bun', 'build', '--compile', src, '--outfile', outfile],
	cwd: rootDir,
	stdio: ['inherit', 'inherit', 'inherit'],
});
if (proc.exitCode !== 0) {
	console.error(`[build-sidecar] Failed with exit code ${proc.exitCode}`);
	process.exit(proc.exitCode ?? 1);
}
console.log('[build-sidecar] Done');
