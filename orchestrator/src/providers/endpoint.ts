/**
 * The provider endpoint, in one place.
 *
 * `deepseek_endpoint` is the only way a user points Conclave at a different
 * provider, and four modules read it: the chat adapter, the `/api/upload`
 * branch, the DanyAPI MCP scaffold and session teardown. Each carried its own
 * copy of the default and its own idea of whether to strip a trailing slash, so
 * "what the setting means" had several answers. This module is the single one.
 *
 * It imports nothing — not the database, not `fetch` — so the normalisation is
 * testable without opening SQLite. Callers that need the *current* value read
 * `repos.getSetting('deepseek_endpoint')` (or the scaffold's `ctx`) and pass it
 * through `resolveEndpoint`.
 */

/** The default DanyAPI endpoint: the seed value and every fallback. */
export const DEFAULT_PROVIDER_ENDPOINT = 'http://127.0.0.1:8000/v1';

/**
 * Turn a raw setting value into a usable base URL: trimmed, with trailing
 * slashes removed so `${endpoint}/chat/completions` cannot produce `//`. An
 * absent, empty or slash-only value falls back to the default.
 */
export function resolveEndpoint(raw: unknown): string {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) return DEFAULT_PROVIDER_ENDPOINT;
	const normalised = value.replace(/\/+$/, '');
	return normalised || DEFAULT_PROVIDER_ENDPOINT;
}
