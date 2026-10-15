/**
 * Pure projections for the public HTTP surface.
 *
 * This module imports neither the database nor the server, so the properties
 * the helpers carry — a path-free bootstrap result and a bounded diagnostic
 * echo — are testable without booting the orchestrator. `BootstrapResult` is a
 * type-only import and is erased at load, so nothing here pulls in `../db`.
 */
import { createHash } from 'crypto';
import type { BootstrapResult } from './bootstrap';

export const MAX_DIAGNOSTIC_LEN = 4096;

/**
 * Collapse line breaks so a client-supplied string cannot forge a second log
 * record, then clip it to MAX_DIAGNOSTIC_LEN and name how much was dropped.
 */
export function sanitizeDiagnostic(value: string | null): string {
	if (value == null) return '';
	const collapsed = value.replace(/\r\n|[\r\n\u2028\u2029]/g, '\\n');
	if (collapsed.length <= MAX_DIAGNOSTIC_LEN) return collapsed;
	const dropped = collapsed.length - MAX_DIAGNOSTIC_LEN;
	return `${collapsed.slice(0, MAX_DIAGNOSTIC_LEN)}…[+${dropped} chars truncated]`;
}

/**
 * Strip absolute filesystem paths out of a text field bound for the public
 * surface. Two shapes are matched rather than one: a Windows drive path and a
 * POSIX absolute path under a directory a home or install would live in.
 */
export function redactPaths(text: string): string {
	if (!text) return '';
	return text
		.replace(/[A-Za-z]:\\[^\s"']*/g, '<path>')
		.replace(/\/(?:Users|home|root|var|tmp|opt)\/[^\s"']*/g, '<path>');
}

/**
 * The service list reaches the same unauthenticated routes as the bootstrap
 * result, and `service.error` carries the absolute directory a failed service
 * looked for. Redact the message, keep the status and the port.
 */
export function redactServiceErrors<T extends { error?: string | null }>(services: T[]): T[] {
	return services.map((service) => (service.error ? { ...service, error: redactPaths(service.error) } : service));
}

export interface PublicBootstrap {
	dbInitialized: boolean;
	danyApiReady: boolean;
	sandboxConfigured: boolean;
	sandboxId: string; // 12 hex chars of sha256(sandboxPath)
}

/** Project a BootstrapResult onto its path-free public shape. */
export function publicBootstrap(result: BootstrapResult): PublicBootstrap {
	const sandboxPath = typeof result.sandboxPath === 'string' ? result.sandboxPath : '';
	return {
		dbInitialized: result.dbInitialized,
		danyApiReady: result.danyApiReady,
		sandboxConfigured: sandboxPath.length > 0,
		sandboxId: createHash('sha256').update(sandboxPath).digest('hex').slice(0, 12)
	};
}
