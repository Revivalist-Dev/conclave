/**
 * Provider session teardown.
 *
 * DanyAPI keeps a server-side session per thread, keyed by the tab id, and its
 * route is `DELETE <endpoint>/sessions/<session_id>` — plural. This module owns
 * that one request so the path, the non-OK handling and the fetch implementation
 * are all testable without a database or a running server: it imports nothing
 * from `../db` and takes its fetch as an argument.
 */

/** The subset of `fetch`'s Response this module reads. */
export interface SessionResponse {
	ok: boolean;
	status: number;
}

export type SessionFetch = (url: string, init?: any) => Promise<SessionResponse>;

export interface DeleteSessionResult {
	ok: boolean;
	status?: number;
	error?: string;
}

/**
 * Delete the provider-side session for a tab. Never throws: a non-OK response
 * and a transport failure both come back as `{ ok: false }` so the fire-and-
 * forget caller in `index.ts` cannot produce an unhandled rejection.
 */
export async function deleteProviderSession(
	endpoint: string,
	tabId: string,
	fetchImpl: SessionFetch = fetch as unknown as SessionFetch
): Promise<DeleteSessionResult> {
	const base = String(endpoint || '').replace(/\/+$/, '');
	const url = `${base}/sessions/${encodeURIComponent(tabId)}`;

	try {
		const res = await fetchImpl(url, {
			method: 'DELETE',
			signal: AbortSignal.timeout(3000)
		});

		if (!res.ok) {
			console.warn(`[Sessions] Provider session delete failed for tab ${tabId} @ ${base}: HTTP ${res.status}`);
			return { ok: false, status: res.status };
		}

		return { ok: true, status: res.status };
	} catch (err: any) {
		const error = err?.message || String(err);
		console.warn(`[Sessions] Provider session delete failed for tab ${tabId} @ ${base}: ${error}`);
		return { ok: false, error };
	}
}
