import { realpathSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

/**
 * Path confinement for the built-in MCP file tools.
 *
 * A raw string prefix test is the wrong instrument: with root `C:\work\conclave`,
 * `C:\work\conclave-backup\secrets.env` passes `startsWith('C:\work\conclave')`,
 * and on Windows the comparison is case-sensitive, so a differently-cased root is
 * wrongly refused. This module canonicalises both sides through the filesystem and
 * compares with the platform separator.
 */

const CASE_INSENSITIVE = process.platform === 'win32';

/**
 * Real path of `target`, falling back to the nearest existing ancestor when the
 * target itself does not exist yet (the write_file case), with the non-existent
 * tail re-appended. Returns null when nothing up to the filesystem root resolves.
 */
function realpathOfNearestExisting(target: string): string | null {
	let current = target;
	while (true) {
		try {
			const real = realpathSync(current);
			if (current === target) return real;
			return join(real, relative(current, target));
		} catch {
			const parent = dirname(current);
			if (parent === current) return null;
			current = parent;
		}
	}
}

/** Fold separators and case so both platforms share one comparison. */
function forCompare(p: string): string {
	if (!CASE_INSENSITIVE) return p;
	return p.replace(/\//g, '\\').toLowerCase();
}

/**
 * True when `candidate` is the root itself or genuinely lives beneath it.
 *
 * `candidate` is resolved against `root` when relative. Both sides are canonicalised
 * with `realpathSync`, so a `..` chain or a symlink inside the root that points outside
 * cannot reintroduce the gap, and a target that does not exist yet is judged against its
 * nearest existing parent rather than failing open.
 */
export function isConfined(root: string, candidate: string): boolean {
	const rootAbs = resolve(root);
	const candidateAbs = resolve(rootAbs, candidate);
	const rootReal = realpathOfNearestExisting(rootAbs);
	const candidateReal = realpathOfNearestExisting(candidateAbs);
	if (rootReal === null || candidateReal === null) return false;
	const r = forCompare(rootReal);
	const c = forCompare(candidateReal);
	if (c === r) return true;
	// A filesystem root ends with the separator already; appending it again would
	// build `c:\\` and refuse every child of a drive root.
	const prefix = r.endsWith(sep) ? r : r + sep;
	return c.startsWith(prefix);
}
