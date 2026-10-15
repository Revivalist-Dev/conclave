/**
 * The DanyAPI pin — which commit of the provider Conclave checks out and builds.
 *
 * Pure on purpose: every value here is a string or an argv array, so the exact
 * git invocation bootstrap runs can be asserted without spawning git, and
 * without importing `./index`, which imports `../db` and would create
 * `orchestrator/data/conclave.db` under test.
 */
import { join } from 'path';

/** The only copy of the provider that still exists — its upstream parent is a 404. */
export const DANYAPI_REPO = 'https://github.com/mindflowgo/DanyAPI.git';

/**
 * The commit every boot checks out. `main` is what the old clone followed, and a
 * branch head is a moving reference; this is not. The fork has not moved since
 * 2026-09-07, but the pin is what makes that irrelevant.
 */
export const DANYAPI_COMMIT = 'e551331ed7d6812a6364a7637aae2e95bb5caa89';

/** First twelve characters, for log lines and warning text. */
export const DANYAPI_COMMIT_SHORT = DANYAPI_COMMIT.slice(0, 12);

/** The `settings` rows this pin is inspectable through. */
export const PINNED_COMMIT_SETTING = 'danyapi_pinned_commit';
export const RESOLVED_COMMIT_SETTING = 'danyapi_commit';
export const IMAGE_SETTING = 'danyapi_image';

/** The commit is fetched directly, so no branch head is ever followed. */
export function fetchArgs(commit: string): string[] {
	return ['fetch', '--depth', '1', 'origin', commit];
}

/** Detached, because the target is a commit rather than a branch head. */
export function checkoutArgs(commit: string): string[] {
	return ['checkout', '--detach', commit];
}

export function revParseArgs(): string[] {
	return ['rev-parse', 'HEAD'];
}

export interface HeadVerification {
	ok: boolean;
	actual: string | null;
	expected: string;
	error: string | null;
}

/**
 * Compare a `git rev-parse HEAD` result with the pin.
 *
 * An unreadable HEAD is a failure, not a pass: the whole point of the pin is
 * that the checkout was verified, and "we could not look" must never be
 * reported as "it matched". Comparison is case-insensitive because git shas are
 * hexadecimal and the case of a recorded one is not a fact about the tree.
 */
export function verifyHead(actual: string | null | undefined, expected: string): HeadVerification {
	const normalized = typeof actual === 'string' ? actual.trim().toLowerCase() : '';
	if (!normalized) {
		return {
			ok: false,
			actual: null,
			expected,
			error: `DanyAPI HEAD could not be read; the pinned commit ${expected.slice(0, 12)} is unverified`
		};
	}
	if (normalized !== expected.toLowerCase()) {
		return {
			ok: false,
			actual: normalized,
			expected,
			error: `DanyAPI HEAD is ${normalized.slice(0, 12)} but the pin is ${expected.slice(0, 12)}; the checkout is NOT at the pinned commit`
		};
	}
	return { ok: true, actual: normalized, expected, error: null };
}

export interface VendoredBuildFile {
	name: string;
	source: string;
	dest: string;
}

/**
 * The build files Conclave owns, in the order they must be written.
 *
 * Dockerfile is last on purpose: it `COPY`s constraints.txt, so a partial
 * application must never be able to leave a Dockerfile behind whose constraints
 * file was never written. The first two are inert on their own.
 */
export function vendoredBuildFiles(
	destDir: string,
	sourceDir: string = join(import.meta.dir, '../../provider-build')
): VendoredBuildFile[] {
	return ['constraints.txt', 'docker-compose.yml', 'Dockerfile'].map((name) => ({
		name,
		source: join(sourceDir, name),
		dest: join(destDir, name)
	}));
}

/** The `settings` rows the pin records, in the order they are written. */
export function pinSettings(actual: string | null, expected: string): Array<[string, string]> {
	const rows: Array<[string, string]> = [[PINNED_COMMIT_SETTING, expected]];
	if (actual) rows.push([RESOLVED_COMMIT_SETTING, actual]);
	return rows;
}
