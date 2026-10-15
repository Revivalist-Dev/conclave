/**
 * Parsers for `docker compose` JSON output.
 *
 * Pure, and separate from `supervisor.ts` for the usual reason: supervisor
 * imports `../db`, so a test that reached these functions through it would open
 * SQLite and create `orchestrator/data/conclave.db`.
 */

/**
 * Compose changed shape mid-life: modern versions print one JSON array, older
 * ones print one JSON object per line. Both are accepted rather than picking a
 * version, because the version is a property of the operator's Docker install.
 */
export function parseComposeJson(stdout: string): any[] {
	const text = (stdout || '').trim();
	if (!text) return [];
	if (text.startsWith('[')) return JSON.parse(text);
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

/**
 * The image id of the first entry `docker compose images` reports, if any.
 *
 * `ID` is the key Compose 5.6.0 emits (measured 2026-10-15); `ImageId` is kept
 * as a tolerant alias rather than the primary, because the key name has differed
 * across Compose versions and an unrecognised key would silently yield no image
 * id at all.
 */
export function imageIdFromComposeImages(stdout: string): string | null {
	for (const entry of parseComposeJson(stdout)) {
		const id = entry?.ImageId ?? entry?.ID ?? null;
		if (typeof id === 'string' && id.trim()) return id.trim();
	}
	return null;
}
