/**
 * Client-side response deadline for a sent prompt (hardening item F1).
 *
 * The orchestrator only signals the end of a turn by broadcasting
 * `CHAT_COMPLETE` or `CHAT_ERROR` (`orchestrator/src/index.ts`). A dead
 * orchestrator does not fail the send either: the Tauri transport queues the
 * payload natively (up to `MAX_QUEUED = 64`) and flushes it on the next
 * connection, so a prompt can complete silently minutes later or never. Without
 * a client deadline the send control spins forever.
 *
 * The constants are anchored on the provider adapter's own budget, not guessed:
 * `orchestrator/src/providers/danyapi.ts` aborts the upstream request with a
 * 60 s `AbortController` (`const timeoutId = setTimeout(() => controller.abort(), 60000)`).
 * A client that gave up before that 60 s would be more impatient than the server
 * and would declare failure while the server still had budget to answer.
 *
 * - `PROMPT_FIRST_TOKEN_TIMEOUT_MS` = 90 000 -- that 60 s plus a 30 s margin for
 *   connection setup, the offline queue flushing, and event-loop lag.
 * - `PROMPT_IDLE_TIMEOUT_MS` = 60 000 -- once tokens are flowing, a full minute
 *   of total silence mid-stream is a stuck stream rather than a slow token.
 *
 * Pure on purpose: no Svelte runes and injectable timers, so `bun test` can
 * verify the arming/clearing behaviour deterministically.
 */

export const PROMPT_FIRST_TOKEN_TIMEOUT_MS = 90_000;
export const PROMPT_IDLE_TIMEOUT_MS = 60_000;

/** Which budget elapsed. `first-token` is "nothing arrived at all"; `idle` is "the stream stalled". */
export type PromptTimeoutPhase = 'first-token' | 'idle';

export interface PromptDeadlineTimers {
	setTimeout: (fn: () => void, ms: number) => any;
	clearTimeout: (id: any) => void;
}

const DEFAULT_TIMERS: PromptDeadlineTimers = { setTimeout, clearTimeout };

export class PromptDeadline {
	private handle: ReturnType<typeof setTimeout> | null = null;
	private settled = false;

	constructor(
		private readonly onExpire: (phase: PromptTimeoutPhase) => void,
		private readonly timers: PromptDeadlineTimers = DEFAULT_TIMERS
	) {}

	/** Arm the first-token budget. Call once per send; it replaces any pending timer. */
	start(): void {
		this.settled = false;
		this.arm(PROMPT_FIRST_TOKEN_TIMEOUT_MS, 'first-token');
	}

	/** A token / tool step / usage frame proves the turn is alive: switch to the idle budget. */
	noteActivity(): void {
		if (this.settled) return;
		this.arm(PROMPT_IDLE_TIMEOUT_MS, 'idle');
	}

	/** Clear on completion, on error, and before a new send, so a timer never outlives its turn. */
	clear(): void {
		this.settled = true;
		if (this.handle !== null) {
			this.timers.clearTimeout(this.handle);
			this.handle = null;
		}
	}

	private arm(ms: number, phase: PromptTimeoutPhase): void {
		if (this.handle !== null) this.timers.clearTimeout(this.handle);
		this.handle = this.timers.setTimeout(() => {
			this.handle = null;
			this.settled = true;
			this.onExpire(phase);
		}, ms);
	}
}
