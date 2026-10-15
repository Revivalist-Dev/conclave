/**
 * The compose-file contract that the vendored compose file must keep.
 *
 * The supervisor health-probes `http://127.0.0.1:8000/v1/models` and the plugin
 * manifest declares the same port, so the service name `danyapi` and the
 * published host port 8000 are load-bearing. A vendored compose file that drifts
 * from either produces a service that builds, runs and is never probed — which
 * nothing else in the tree would notice.
 *
 * Pure: text in, verdict out. No fs, no db.
 */

export interface ComposeContract {
	service: string | null;
	hostPort: number | null;
}

const SERVICES_BLOCK = /^services\s*:\s*$/;
const KEY_LINE = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*$/;
const PUBLISH_LINE = /^\s*-\s*["']?(\d+):(\d+)["']?\s*$/;

/**
 * Read the first service name and the first published host port out of compose
 * text. A line scan rather than a YAML parser on purpose: only these two values
 * are contractual, and a YAML dependency would be a wider surface than the check
 * is worth. The service name is the first key at the shallowest indent inside
 * the `services:` block.
 */
export function composeContract(text: string): ComposeContract {
	let inServices = false;
	let serviceIndent = -1;
	let service: string | null = null;
	let hostPort: number | null = null;

	for (const line of text.split(/\r?\n/)) {
		if (!inServices) {
			if (SERVICES_BLOCK.test(line)) inServices = true;
			continue;
		}

		const key = KEY_LINE.exec(line);
		if (key) {
			const indent = key[1].length;
			// A key back at column zero ends the block; `services:` itself is the
			// only such key the caller's file has.
			if (indent === 0) break;
			if (serviceIndent === -1) serviceIndent = indent;
			if (service === null && indent === serviceIndent) service = key[2];
		}

		if (hostPort === null) {
			const published = PUBLISH_LINE.exec(line);
			if (published) hostPort = Number(published[1]);
		}
	}

	return { service, hostPort };
}

/**
 * The reason the file cannot be used, or null when it can.
 *
 * Returned rather than thrown so the caller decides what to do — bootstrap keeps
 * the checkout's own compose file instead of writing one that would break the
 * health probe, and says so loudly.
 */
export function composeContractError(
	text: string,
	expectedService: string = 'danyapi',
	expectedPort: number = 8000
): string | null {
	const { service, hostPort } = composeContract(text);
	if (service !== expectedService) {
		return `compose file declares service ${service ?? '(none)'}, expected ${expectedService}`;
	}
	if (hostPort !== expectedPort) {
		return `compose file publishes host port ${hostPort ?? '(none)'}, expected ${expectedPort}`;
	}
	return null;
}
