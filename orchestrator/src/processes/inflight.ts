/**
 * Collapse concurrent calls for the same key into a single in-flight operation.
 *
 * `startService` acquires a Docker container, and two independently written boot
 * paths can ask for the same service on the same boot: `supervisor.startAll()`
 * and `pluginManager.restore()` -> `startPlugin`'s docker branch. They are not
 * ordered against each other, so both callers can see a dead port and both run
 * `docker compose up -d`, and the second recreates the container while the first
 * is still being health-polled. A status check cannot close that window, because
 * neither caller has written a status yet.
 *
 * The first caller's promise is recorded and handed to every later caller for the
 * same key, so a second arrival awaits the first result instead of issuing its own
 * command. The entry is dropped once the promise settles, including on failure, so
 * a later caller can still retry a service that failed rather than being served a
 * cached rejection forever.
 *
 * Extracted from `supervisor.ts` so the normalisation is testable without SQLite:
 * `supervisor.ts` imports `../db`, and importing that module in a test creates the
 * repository database.
 */
export function dedupeInFlight<T>(
	inflight: Map<string, Promise<T>>,
	key: string,
	factory: () => Promise<T>
): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing;

	// The factory is invoked synchronously (so the operation starts on the call,
	// not a tick later), and the cleanup is attached to the settled promise rather
	// than written as a `finally` inside it: a factory that throws synchronously
	// rejects before the entry below is recorded, and a `finally` would then clear
	// a key that had not been set, caching the rejection forever.
	const promise = (async () => await factory())();
	inflight.set(key, promise);

	const clear = () => {
		if (inflight.get(key) === promise) inflight.delete(key);
	};
	promise.then(clear, clear);
	return promise;
}
