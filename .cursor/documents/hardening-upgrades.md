---
title: Conclave hardening upgrades — prioritised, grounded in the tree
topic: hardening-upgrades
updated: 2026-10-15
status: current
---

# Conclave hardening upgrades — prioritised, grounded in the tree

A prioritised set of changes that would make Conclave more robust **as a tool**. Every item below is
grounded in something read out of the tree on **2026-10-15** — a `file:line`, a missing check, a swallowed
error, a hardcoded value, an unpinned dependency, an untested path. Nothing here is a wish list, and §9
lists what is already good so the list reads as a signal rather than a complaint.

The single external dependency this page leans on most is reviewed separately in
[DanyAPI review](./danyapi-review.md); items marked **[D]** there are the Conclave-side half of a coupling
finding.

> **Read the quoted text, not the line number — the numbers here are unvalidated and some are wrong.**
> Every citation was read at one point on 2026-10-15, and a line number is a claim about a file that can
> move. A later audit of this page found **eight** refs whose content is present but whose number is off.
> Of **five** of those checked directly against the tree, the audit was right **four** times and wrong
> **once** — so neither this page nor an audit of it is authoritative. Verified examples: `formData.get('model')`
> is at `orchestrator/src/index.ts:263`, cited here as `:277`; the `[DanyAPI] … tokens used` log is at
> `orchestrator/src/providers/danyapi.ts:154`, cited as `:147`, which is a comment line; `newMessageId` is
> at `orchestrator/src/db/helper.ts:65-69`, cited as `:70-74`.
> **What to do instead:** search for the quoted string rather than trusting the number
> (`rg -n "the quoted text" <file>`), which is the only form of citation that survives an edit. The
> findings themselves were checked against the tree and reproduced; it is the addresses that drifted.
> A page that says "at `595f786`, `.gitignore:32` was `.cursor/`" is pinned; a bare `:32` is not.

## 0. The four defect patterns this page hunts for

Four shapes recur across the tree. They are named once here and tagged **[K1]**–**[K4]** on each item, so
the pattern can be searched for rather than re-argued.

| Tag | Pattern | How to recognise it |
|---|---|---|
| **[K1]** | **Select for success.** A `try/catch` or output filter that keeps only the happy path, so a total failure is indistinguishable from a quiet no-op. The reference instance is `scripts/build-sidecar.ts:74-78`, fixed to `console.warn` — a copy failure now prints `WARNING` instead of vanishing. | `catch {}`, a predicate that returns `true` on any non-throw, a status set to `running` in the failure branch, an error rendered as content |
| **[K2]** | **Unknown flag ignored.** A tool advertises a parameter set and then silently discards anything outside it instead of rejecting the call. | a declared `inputSchema` that is never used for validation; `args.x \|\| default` reads with no exhaustive check |
| **[K3]** | **Lockfile/manifest pair nothing validates.** Two files must agree and no command checks that they do. | more than one lockfile for one manifest; a lockfile format the project's package manager doesn't write |
| **[K4]** | **Version pinned to a moving tag.** A reference that resolves to whatever exists when it is read. | `:latest`, a bare `FROM python:3.x`, a branch name, a bare package name |

**[K1]** is measured in this workspace, not hypothesised: `build-sidecar.ts` had exactly this bug and the
fix is in place. The hunt below found **nine more live instances** of it, and they are the highest-value
items on this page.

## 1. Correctness

### C1 — The provider session teardown calls a route that does not exist **[D]**

**Finding.** Deleting a tab is documented as "best-effort upstream session teardown" and has never torn
down a session.

**Evidence.**
```44:56:orchestrator/src/index.ts
function deleteProviderSessions(tabId: string): void {
	const endpoints: string[] = [];
	try {
		if (repos.isDeepSeekEnabled()) {
			const endpoint = String(repos.getSetting('deepseek_endpoint') || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
			endpoints.push(endpoint);
		}
	} catch {}

	for (const endpoint of endpoints) {
		fetch(`${endpoint}/session/${encodeURIComponent(tabId)}`, {
			method: 'DELETE',
```
`endpoint` is `http://127.0.0.1:8000/v1`, so this is `DELETE /v1/session/<tabId>`. DanyAPI's route is
`DELETE /v1/sessions/{session_id}` — plural — at `danyapi/api/openai.py:1446` in `mindflowgo/DanyAPI`.
Note the doc comment at `index.ts:41` states the wrong path too, so the comment and the code agree with
each other and with nothing else. Called from `index.ts:211` (`DELETE /api/tabs/:id`) and `index.ts:461`
(`TAB_DELETE`).

**Proposed change.** Fix the path to `/sessions/`, and stop treating a non-OK response as an ignored
failure: log the status at `warn` and record it, so the next wrong URL is visible.

**Effort.** S.

**How to test it worked.** Delete a tab with a known id, then
`curl -s 'http://127.0.0.1:8000/v1/sessions' | jq` before and after — the id must disappear. Today it
stays. This is a two-request integration test and it is the cheapest total-failure check in the tree.

### C2 — Bootstrap reports `danyApiReady: true` for an empty directory **[K1]**

**Finding.** A failed clone, an unreachable network, or a fork that has been deleted all produce a
successful bootstrap report.

**Evidence.** `orchestrator/src/bootstrap/index.ts:57-68` — the clone branch sets `danyReady = true` only
when `cloneResult.status === 0 && existsSync(danyDir)` (`:57-59`), but **both failure branches then do the
same**:

```62:68:orchestrator/src/bootstrap/index.ts
				mkdirSync(danyDir, { recursive: true });
				danyReady = true;
			}
		} catch (err: any) {
			console.warn(`[Bootstrap] Failed to clone ${danyRepo}: ${err.message}. Creating directory stub.`);
			mkdirSync(danyDir, { recursive: true });
			danyReady = true;
```

`danyReady` is returned as `danyApiReady` and rendered into `/health`
([`index.ts:158-176`](../../orchestrator/src/index.ts)) and `/api/settings/load`. A stub directory and a
working clone are the same value.

**Proposed change.** Split the two outcomes: `danyApiReady` must mean "a `docker-compose.yml` and a
`DanyAPI/` source tree exist", not "a directory exists". Add `danyError: string | null` alongside it and
surface it in `/health`.

**Effort.** S.

**How to test it worked.** Delete `api_sandbox/DanyAPI`, point `danyRepo` at an unreachable host, boot the
orchestrator, and assert `/health` reports `danyApiReady: false` with a non-null error. Today it reports
`true`.

### C3 — The supervisor marks a container `running` after `docker compose up` failed **[K1]**

**Finding.** A failed compose invocation that also fails its health poll ends with the service recorded as
running.

**Evidence.** `orchestrator/src/processes/supervisor.ts:139-154` warns when `upRes.status !== 0` and
**does not return** — it falls through to the log streamer and the 10× 1 s health poll. Then:

```164:168:orchestrator/src/processes/supervisor.ts
				service.status = 'running';
				console.log(`[Supervisor] ${service.name} (DeepSeek/Qwen) verified healthy on http://127.0.0.1:${service.port}`);
			} else {
				service.status = 'running'; // Container is up, proxy still warming up
				console.log(`[Supervisor] ${service.name} container is running; warming up.`);
```

The comment's claim is not checked: nothing verifies a container is up on the timeout branch. Combined
with C2 this is two stacked happy-path selections on the same failure, and
`recordState` writes `running` into `service_state`.

**Proposed change.** On the timeout branch, verify with the daemon (`docker compose ps --format json`, or
success of the `up`) before claiming `running`; otherwise set `failed` with the compose stderr as `error`.
Return early when `upRes.status !== 0` and the daemon is unreachable.

**Effort.** S.

**How to test it worked.** Rename `api_sandbox/DanyAPI/Dockerfile` so the build fails, boot, and assert
`GET /health` reports `services[0].status === 'failed'` with a non-empty `error`. Today it reports
`running`.

### C4 — MCP tool arguments are never validated against the advertised schema **[K2]**

**Finding.** Every tool publishes an `inputSchema`; not one call site reads it. Unknown or misspelled
arguments are silently ignored, and a caller gets a plausible answer for a request that was never made as
asked.

**Evidence.** `run_command`, `read_file`, `write_file` and `get_service_status` are declared with
`inputSchema` at `orchestrator/src/mcp/index.ts:42-80`, then executed by direct field access with no
validation at `:244-355` (`args.command`, `args.cwd`, `args.path`, `args.content`). Plugin tools go the
same way: `orchestrator/src/plugins/index.ts:435` passes `args` straight to the scaffold, and the DanyAPI
scaffold reads only `args?.question` and `args?.session_id` — so `{"questions": "..."}` returns
`{"content":[{"type":"text","text":"No question provided."}],"isError":true}`, which at least fails, while
`{"question":"x","sessionID":"y"}` silently drops the session binding and answers from a different session
than the caller intended.

**Proposed change.** Validate `params.arguments` against the tool's own `inputSchema` before dispatch, with
`additionalProperties: false` on the built-ins and on the DanyAPI tools, and return JSON-RPC `-32602` for a
schema mismatch — the same error shape the code already uses for a missing `name`
(`orchestrator/src/mcp/index.ts:136-142`). A ~40-line validator covers the subset in use (object,
required, string/integer/boolean, additionalProperties).

**Effort.** M.

**How to test it worked.** `echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_command","arguments":{"cmd":"echo hi"}}}' | node orchestrator/bin/mcp-server.js`
must return `-32602` naming `command`, not `Error: "command" parameter is required` inside a `result`
envelope. Add one table-driven case per tool, including an unknown extra key.

### C5 — Path confinement is a text prefix check, so a sibling directory escapes **[K1]-adjacent**

**Finding.** `read_file` and `write_file` are documented and rendered in the UI as "safely inspects and
modifies project files within workspace boundaries". The check is a string prefix test, which a sibling
path defeats.

**Evidence.**
```298:304:orchestrator/src/mcp/index.ts
				const filePath = resolve(this.rootDir, args.path);
				if (!filePath.startsWith(this.rootDir)) {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: `Access denied: path '${args.path}' is outside project root` }], isError: true }
					};
```

With `rootDir = C:\work\conclave`, the argument `..\conclave-backup\secrets.env` resolves to
`C:\work\conclave-backup\secrets.env`, and `startsWith('C:\work\conclave')` is **true**, so the read is
allowed. The same shape is used for the `run_command` cwd at `:261` and for `write_file` at `:337`. On
Windows the check is also case-sensitive, so a differently-cased root is wrongly *rejected* — a second
signal that a text comparison is the wrong tool.

**Proposed change.** Compare with a separator: `filePath === rootDir || filePath.startsWith(rootDir + sep)`
using `path.sep`, and canonicalise both sides with `realpathSync` so a symlink or a `..` chain cannot
reintroduce the gap. `rootDir` itself should come from a real setting rather than `process.cwd()` — see S5.

**Effort.** S.

**How to test it worked.** Two cases, both assertable in one script: `..\sibling\file` must be denied, and
a file genuinely inside the root must still be allowed. Today the first is allowed.

### C6 — The UI offers providers the router cannot serve

**Finding.** Selecting Claude, Ollama, LM Studio or vLLM in the UI sends the request to DanyAPI with a
model id DanyAPI has never heard of, and the user sees the provider error as if the model existed.

**Evidence.** `client/web/src/lib/stores/harness.svelte.ts` `INITIAL_PROVIDERS` declares six providers with
hardcoded `status: 'online'` and fabricated latencies — including `Claude Opus 5 High`, `Llama 3.3 70B` and
`Mistral Large 2`. The router's selector has no branch for any of them:

```18:25:orchestrator/src/providers/index.ts
export function getProvider(name?: string): ProviderAdapter {
	const prov = (name || '').toLowerCase();
	if (prov.includes('deepseek') || prov.includes('dany') || prov.includes('qwen') || prov === 'default' || !prov) {
		return danyApiProvider;
	}
	// Future adapters (Gemini, Claude, Ollama, LM Studio) can be routed here
	return danyApiProvider;
}
```

Both paths return `danyApiProvider`, so `provider: 'Claude'` reaches DanyAPI with
`model: 'Claude Opus 5 High'` and 404s. `orchestrator/src/providers/mock.ts` defines a `LocalMockProvider`
that would at least answer — it is imported and re-exported at `providers/index.ts:3, 7` and never routed
to.

**Proposed change.** Make the provider list data-driven from what the plugins actually declare —
`harness.syncPluginModels` already does the right thing for models and is only used on `PLUGINS_UPDATED` —
and either implement the adapters or remove the entries. Route the unknown-provider case to
`localMockProvider` so the failure is legible instead of being an upstream 404.

**Effort.** M.

**How to test it worked.** Assert that every `provider` value the UI can send resolves to an adapter whose
`name` matches, and that a request for each declared model gets either a token stream or an error naming
the model — never a DanyAPI 404 passed through as prose.

### C7 — IDs can collide, and a collision throws

**Finding.** Tool-step ids are 8 characters drawn from a 1-second clock plus a non-cryptographic 2-character
random, in a global namespace shared by every message in every tab; the insert is a plain `INSERT`, so the
second writer throws.

**Evidence.** `orchestrator/src/db/helper.ts:76-88`:
```76:88:orchestrator/src/db/helper.ts
/** 8 chars: 6-char timestamp(seconds) + 2-char random */
export function newToolStepId(): string {
	const ts = Math.floor(Date.now() / 1000);
	const rand = Math.floor(Math.random() * (58 * 58));
	return encodeB58(ts, 6) + encodeB58(rand, 2);
}
```
The random space is 58² = **3364 values**, and `Math.random()` is not a CSPRNG. `newMessageId` at `:70-74`
has the same construction but is at least tab-scoped. The inserts are
`db.prepare('INSERT INTO tool_steps ...')` at `orchestrator/src/db/index.ts:218-225` with no `OR REPLACE`
and no retry, while `settings` and `plugins` in the same file both use `INSERT OR REPLACE` — the intent is
inconsistent.

**Proposed change.** Use `crypto.randomUUID()` or a monotonic counter (`nextSeq` already exists and is
read-modify-write synchronous, so it is safe on Bun's single thread) for message and tool-step ids, and
make both inserts `INSERT OR REPLACE` or retry once on a primary-key conflict.

**Effort.** S.

**How to test it worked.** Insert 10 000 tool steps in a tight loop within one second and assert 10 000
rows. Add a unit test that asserts `newToolStepId()` output is unique across 10 000 calls.

### C8 — `/api/upload` has no size cap and overwrites files

**Finding.** An unbounded multipart body is written to disk, and a repeated filename silently replaces the
previous file while leaving the old row in `uploads`.

**Evidence.** `orchestrator/src/index.ts:265-280`: `mkdirSync(dataDir, { recursive: true })` then, per file,
`file.name.replace(/[^a-zA-Z0-9._-]/g, '_')` — which does neutralise traversal — but then
`writeFileSync(savedPath, Buffer.from(arrayBuffer))` with no `file.size` check, no total-request cap and no
uniquifying suffix. DanyAPI itself caps at `MAX_ATTACHMENT_TOTAL_SIZE = 10 * 1024 * 1024` and
`MAX_FILES_PER_REQUEST = 50` (`danyapi/api/attachments.py:18-19`), so Conclave accepts strictly more than
the thing it forwards to.

**Proposed change.** Reject a file over the same 10 MB the upstream refuses, cap the count per request,
prefix the stored name with the upload id (already generated at `:325`) or a short hash, and note the
overwrite in the `uploads` row.

**Effort.** S.

**How to test it worked.** POST a 20 MB file and assert a 413 with a readable message and no file on disk;
POST two files with the same name and assert two distinct paths and two `uploads` rows.

### C9 — Upload model selection is a hardcoded two-way branch

**Finding.** Every non-Qwen upload is forwarded as `model: 'default'`, including `deepseek-v4-pro` and
`deepseek-v4-vision`.

**Evidence.** `orchestrator/src/index.ts:290` —
`const effectiveModel = rawModel.includes('qwen') ? rawModel : 'default';` — where `rawModel` came from
`formData.get('model') || 'default'` at `:277`. The 404 retry at `:302` re-sends the *same URL* without the
model, so it cannot recover from a rejected model; and against the snapshot there is no `/v1/files` at all
for it to retry against. **[D]**

**Proposed change.** Send the caller's model verbatim (the provider adapter already does exactly this at
`orchestrator/src/providers/danyapi.ts:43`), and make the fallback a real branch — on 404, either re-stage
the attachment as a `files[]` entry on the completions request or fail with a message that names the
capability rather than retrying the same URL.

**Effort.** S.

**How to test it worked.** Upload with `model=deepseek-v4-pro` and assert the request DanyAPI receives
carries that model (log it, or assert on the stored `uploads` row plus the DanyAPI log line).

## 2. Failure visibility

### F1 — The send button can spin forever **[K1]**

**Finding.** `isGenerating` is set before the WebSocket branch and reset only by a server broadcast; there
is no timeout and no client-side deadline.

**Evidence.** `client/web/src/lib/stores/harness.svelte.ts`:
```754:781:client/web/src/lib/stores/harness.svelte.ts
		this.isGenerating = true;

		// 1. If inside Tauri or WebSocket connected, stream directly via WebSocket
		if (isTauriEnvironment() || (typeof window !== 'undefined' && (window as any).__orchestratorSocket?.status === 'connected')) {
			...
			(window as any).__orchestratorSocket?.send({
				type: 'PROMPT_SEND',
				...
			});
			return;
		}
```
The only reset is `this.isGenerating = false` at `:874`, inside the `finally` of the *HTTP fallback* path.
Everything on the WS path depends on `CHAT_COMPLETE` or `CHAT_ERROR` arriving. Those come from
`orchestrator/src/index.ts:536-576`, and if the orchestrator is dead the send is not lost — it is **queued
natively**, up to `MAX_QUEUED = 64` payloads, and flushed on the next connection
(`client/tauri/src-tauri/src/orchestrator_ws.rs:21, 216-222`). So a prompt sent into a dead socket
completes silently minutes later, or never.

**Proposed change.** Arm a client-side deadline when the prompt is sent (30 s to first token, then an
idle-based timeout), and on expiry clear `isGenerating`, mark the placeholder message as failed and offer a
retry. A `CHAT_TIMEOUT` broadcast from the orchestrator for its own 60 s `AbortController`
(`orchestrator/src/providers/danyapi.ts:90-91`) gives the same signal from the other end.

**Effort.** S.

**How to test it worked.** Kill the orchestrator, send a prompt, and assert the send control returns to
idle within the deadline with a visible failure on the message — not an indefinite spinner.

**Fix.** Applied 2026-10-15 in `client/web`. The deadline is a new pure module, `client/web/src/lib/services/promptDeadline.ts` — a `PromptDeadline` class with injectable timers and a `start()` / `noteActivity()` / `clear()` surface, no Svelte runes and no DOM. Two constants, both derived from the provider adapter's own budget rather than guessed: `PROMPT_FIRST_TOKEN_TIMEOUT_MS = 90_000` and `PROMPT_IDLE_TIMEOUT_MS = 60_000`. `orchestrator/src/providers/danyapi.ts` aborts its upstream request with `setTimeout(() => controller.abort(), 60000)`, so a client deadline under 60 s would declare failure while the server still had budget to answer; 90 s is that 60 s plus a 30 s margin for connection setup, the native offline queue flushing, and event-loop lag. The idle budget equals the server's single 60 s window, because a full minute of silence mid-stream is a stuck stream rather than a slow token. The store (`client/web/src/lib/stores/harness.svelte.ts`) arms it in `sendMessage` **before either transport** — `this.pendingTurn = { tabId: conv.id, messageId: null }; this.promptDeadline.start();` immediately after `this.isGenerating = true` — and fills in `pendingTurn.messageId` when each branch pushes its placeholder, since `conv.messages.push(assistantMsg)` appears in both the WS and the HTTP branch. Two new public methods, `noteGenerationActivity()` and `endGeneration()`, are the only other entry points; expiry runs `expirePromptTurn`, which clears `isGenerating` and sets `error = true` on the guarded assistant message. **Every timer is cleared on the happy path too**, which is the trap this workspace has on record: the socket service's `CHAT_COMPLETE` and `CHAT_ERROR` cases and the HTTP fallback's `finally` all call `endGeneration()`, so the `finally` reset at the old line 874 is unchanged in effect and now clears the timer with it; `CHAT_TOKEN`, `TOOL_STEP_UPDATE` and `CHAT_USAGE` in `client/web/src/lib/services/orchestratorSocket.svelte.ts` call `noteGenerationActivity()`, which re-arms the idle budget and drops a stale failure flag if a queued prompt is flushed and answered after the deadline already fired; and a new send calls `start()`, which clears any pending handle first. The `error` flag now reaches the client: the server column is `error INTEGER NOT NULL DEFAULT 0` and the read path is `SELECT *` (F3), so the integer arrives on the row, and `handleTabDetail` — the single mapping site for both transports, `TAB_DETAIL` over WS and `GET /api/tabs/:id/messages` — now coerces with `error: m.error === 1 || m.error === true`; `Message` in `client/web/src/lib/types.ts` gained `error?: boolean`. `client/web/src/lib/components/ConversationView.svelte` renders an assistant message with `error === true` as a small `⚠ Response failed — no usable answer was returned.` banner in the existing Tailwind idiom (`bg-red-950/40 border-red-900/60 text-red-300`), placed above the content block, with the typing-dots branch guarded by `!message.error` so an expired placeholder shows the failure instead of three bouncing dots; nothing was restyled, and **this closes F3's "nothing in `client/` reads the flag" caveat** (noted on F3 below). **Retry is explicitly not implemented** — the client has no resend affordance anywhere (`retry`, `resend` and `regenerate` have no symbol in `client/web/src`) and the brief forbade inventing a new UI pattern. `CHAT_TIMEOUT` was not added and `orchestrator/` was not touched, so the broadcast half of the Proposed change above remains open. Proved with `bun test` — the first test file in the tree — at `client/web/tests/promptDeadline.test.ts`: five cases for first-token arming and expiry, the swap to the idle budget with the earlier timer cleared, `clear()` leaving zero pending timers, re-arm on a new send, and no re-arm after expiry. It sits in `tests/` rather than beside the module because `tsconfig.json` includes `["src", "test", "*"]`, so a `*.test.ts` under `src/` would pull `bun:test` into `svelte-check` and fail unless `@types/bun` were added. Gates, all run from `client/web`: `bun run check` → `svelte-check found 0 errors and 6 warnings in 5 files`, exit **0**, identical to the pre-change run (0 errors, 6 warnings, exit 0); `bun run build` → exit **0**; `bun test` → 5 pass, 0 fail, exit **0**. The one new diagnostic the test file did produce was `Cannot find module 'bun:test'` while it lived under `src/`, which is what moved it. **The 90 s budget is confirmed, not provisional:** the Proposed change above suggests 30 s to first token; the operator was asked directly on 2026-10-15 and chose to keep 90 s, so the constants should not be "corrected" back toward the proposal without asking again.

### F2 — A malformed stream chunk is discarded, so a broken stream looks like a short answer **[K1]**

**Finding.** Every line-level parse failure in the SSE reader is swallowed except one specific error string.

**Evidence.**
```158:160:orchestrator/src/providers/danyapi.ts
					} catch (err: any) {
						if (err.message?.includes('DeepSeek error:')) throw err;
					}
```
A `JSON.parse` failure on a truncated chunk, or any other error thrown inside the loop, is dropped without
a log line. The user sees a response that stops early with no indication that anything was lost.

**Proposed change.** Count discarded lines and throw (or at minimum `console.warn` once with the raw line)
when the stream produced no usable chunk; classify "no tokens and no error" as a failure rather than an
empty success. This is the same shape as the `build-sidecar.ts` fix and it belongs in the log at the same
severity.

**Effort.** S.

**How to test it worked.** Point the provider at a stub that emits `data: {not json}` followed by
`data: [DONE]` and assert the router surfaces an error rather than saving an empty assistant message.

**Fix.** Applied 2026-10-15 in `orchestrator/src/providers/danyapi.ts`. The `DeepSeek error:` rethrow is unchanged. A malformed `data:` line now increments `discardedLines` and warns with the raw line (`[DanyAPI] Discarded malformed stream line N: <line>`); the reader now also counts `usableChunks` (incremented at both yield sites) and tracks `sawTerminator`, and throws when `usableChunks === 0 && (discardedLines > 0 || !sawTerminator)`, naming the provider, the endpoint and that nothing parsed. **One deliberate deviation from the brief:** a stream whose only content is `data: [DONE]` (0 discarded, terminator seen) is left as an empty success rather than converted to a failure — a clean terminator is the signal that separates a legitimate empty completion from a truncation, and the brief's "no usable chunk and no error means failure" as written makes those two indistinguishable. Proved with `bun orchestrator/probe-f2-stream.ts <case>` against a stub bound to the provider's hardcoded `127.0.0.1:8000/v1`: `malformed` warns and throws, `truncated` throws, and `doneOnly` / `clean` / `cleanNoUsage` / `deepseekError` are identical to the pre-fix module. The throw reaches the router's `catch`, which yields a `type: 'error'` event; the "rather than saving an empty assistant message" half of the test above belongs to **F3**, which landed the same day — the router now flags the row and writes a failure marker to `last_response`, while the message `content` still carries the notice to any reader that ignores the flag.

### F3 — A provider failure is saved as a successful message

**Finding.** On a provider error the router appends the error text as a **token**, still yields
`complete`, and still writes an assistant message and updates the tab's last-response snippet.

**Evidence.** `orchestrator/src/router/index.ts:62-101` — the `catch` builds `errorNotice`, appends it to
`fullResponse`, yields it as `{ type: 'token' }`, yields `{ type: 'error' }` after it, and then falls
through to `repos.addMessage(tabId, 'assistant', fullResponse, ...)` and
`repos.updateTabLastResponse(...)` at `:84-94`, followed by a `complete` event at `:96-105`.

The `error` event *is* handled (`index.ts:543-550` → `CHAT_ERROR`), so this is not invisible — but the
persisted record is a normal assistant message, and the Sidebar's `last_response` preview shows the error
as if it were content.

**Proposed change.** Mark the message row (`messages.error` or a `role: 'system'` companion) and set the
tab's `last_response` to a short failure marker; keep the `CHAT_ERROR` path as the live signal.

**Effort.** S.

**How to test it worked.** Stop the DanyAPI container, send a prompt, then `GET /api/tabs/:id/messages`
and assert the assistant row is flagged as an error and `tabs.last_response` is not the error text.

**Fix.** Applied 2026-10-15. `messages` now carries `error INTEGER NOT NULL DEFAULT 0`, declared in
`orchestrator/src/db/schema.ts` (mirrored in `schema.sql`, which the module header says stays in sync) and
added to a database that predates it by a second guarded `ALTER TABLE` beside the `tabs.archived`
precedent in `initDatabase()` (`orchestrator/src/db/index.ts`). `repos.addMessage` takes an optional
trailing `opts?: { error?: boolean }`, INSERTs the flag and returns it, so every existing positional caller
is unchanged. The read path needed no edit: all three `getTabMessages` queries are `SELECT *`, so the
column reaches the client in the row shape automatically. The router's provider-failure path now sets
`providerError`, persists the assistant row with `{ error: true }`, and sets `last_response` to the marker
`⚠ Provider error` instead of the error text; the live `{ type: 'error' }` yield and its `CHAT_ERROR`
handling are untouched. The row's `content` is still the error notice, now flagged rather than disguised:
rendering an errored row in the history was a separate, later item — **closed the same day by F1's fix**,
which added `error` to the client `Message` type and a failure banner to `ConversationView.svelte` — and
`client/` was not touched by this change. Proved
with `bun orchestrator/probe-f3-persist.ts`, which pre-seeds a database with the pre-fix `messages` table
(no `error` column) and one historical row, binds a stub to the provider's hardcoded
`127.0.0.1:8000/v1`, and drives the router twice. `case=migration` shows the column appended and the
historical row defaulted to `0`; `case=fail` (HTTP 500) yields `events=["token","error","complete"]` with
`assistantRow.error=1`, `assistantRow.content="> **DanyAPI Error**: upstream exploded"` and
`tabLastResponse="⚠ Provider error"`; `case=ok` yields `error=0` with `content="Hello world"` and
`tabLastResponse="Hello world"`, so the flag is not stuck on. `orchestrator/data/conclave.db` is untouched —
it does not exist, and `CONCLAVE_DATA_DIR` points at `%TEMP%`. Neither `package.json` offers a typecheck or
lint script: `orchestrator` declares only `test: bun test`, which exits **1** with `No tests found!`
because the tree has zero test files (D2). A `tsc --noEmit` over `orchestrator/src/index.ts` using the
vendored TypeScript 6.0.3 in `client/web/node_modules` reports the same **64** pre-existing diagnostics
before and after the change (exit **2** in both), the only difference being a one-line shift in
`router/index.ts`; `bun build src/index.ts --target=bun` exits **0**.

### F4 — A failed `git pull` of the provider is invisible **[K1]**

**Evidence.** `orchestrator/src/bootstrap/index.ts:71-78`:
```73:78:orchestrator/src/bootstrap/index.ts
			const pullResult = spawnSync('git', ['pull'], { cwd: danyDir, encoding: 'utf-8', timeout: 15000 });
			if (pullResult.status === 0) {
				console.log('[Bootstrap] DanyAPI updated.');
			}
		} catch {}
		danyReady = true;
```
A non-zero `pullResult.status` logs nothing, and the `catch` is empty. A local tree that is 20 commits
behind its remote is indistinguishable from a current one.

**Proposed change.** Log `pullResult.stderr` at `warn` on a non-zero status and record the resolved commit
sha in `settings` so drift is inspectable.

**Effort.** S.

**How to test it worked.** Make the local clone dirty so `git pull` fails, boot, and assert one `warn` line
carrying the stderr.

### F5 — Non-JSON lines from a plugin's MCP server are dropped without a trace **[K1]**

**Evidence.** `orchestrator/src/plugins/index.ts:130-131`:
```130:131:orchestrator/src/plugins/index.ts
			} catch {
				// not JSON — ignore
```
The same loop discards any syntactically valid response whose `id` is not in `pending` (`:118-129`) — so a
plugin that answers with the wrong id, or emits a protocol error frame, looks like a plugin that said
nothing. `McpStdioClient` also never handles a server→client *request*.

**Proposed change.** Log the first N unparsable lines and any response with an unmatched id at `warn`, with
a per-client counter so a chatty plugin cannot flood the log.

**Effort.** S.

**How to test it worked.** Register a plugin whose stdio server prints one non-JSON line then answers
`tools/list` normally; assert a `warn` appears and the tool list still loads.

### F6 — Plugin event handler failures are swallowed **[K1]**

**Evidence.** `orchestrator/src/plugins/bus.ts:12-16` — `for (const fn of handlers[event] || []) { try { fn(payload); } catch {} }`.
A handler that throws on every `tab-created` (the DanyAPI path uses it at
`orchestrator/src/plugins/index.ts:552`) silently stops updating windows.

**Proposed change.** Log the event name and the error at `warn`. This is a three-line change and it
converts a whole class of silent staleness into a log line.

**Effort.** S.

**How to test it worked.** Register a handler that throws, emit the event, assert a `warn` naming the event.

### F7 — A service is "healthy" if anything on its port answers 404

**Evidence.** `orchestrator/src/plugins/index.ts:587` —
`if (res.ok || res.status === 404) return true; // 404 still means "alive"`. The comment states the intent,
and the intent is too weak: any process bound to the port during the 15 s window makes a Bun plugin report
`running`, after which `tools/list` advertises tools that do not exist.

**Proposed change.** Require a route the plugin's manifest declares, or the plugin's own `healthPath`, and
treat 404 as unhealthy. Keep the lenient behaviour only behind an explicit manifest flag.

**Effort.** S.

**How to test it worked.** Start a bare `http.server` on the plugin's declared port, enable the plugin, and
assert `status === 'failed'`.

### F8 — `callMcp` never settles if no response arrives

**Finding.** The client's JSON-RPC helper inserts a resolver into a `Map` and awaits it with no timer, so a
dropped response leaks the entry permanently and the caller's promise never resolves — which also makes
`handleMessage`'s `pendingResolvers` grow unboundedly.

**Evidence.** `client/web/src/lib/services/orchestratorSocket.svelte.ts:126-138`:
```126:138:client/web/src/lib/services/orchestratorSocket.svelte.ts
	public async callMcp(method: string, params?: any): Promise<any> {
		const id = this.rpcIdCounter++;
		const rpc = { jsonrpc: '2.0', id, method, params };

		return new Promise((resolve) => {
			this.pendingResolvers.set(id, resolve);
			const sent = this.send({ type: 'MCP_REQUEST', rpc });
			if (!sent) {
				this.pendingResolvers.delete(id);
				resolve({ jsonrpc: '2.0', id, error: { code: -32000, message: 'WebSocket not connected' } });
			}
		});
	}
```
The `!sent` branch is handled. The sent-but-never-answered case is not — and the server *does* have a
silent path that produces no reply: any message whose `method` is a notification, or the `default` case
returning `null` (`orchestrator/src/mcp/index.ts:96-97, 237-240`), which `index.ts:135-141` turns into
`204 No Content` and never forwards.

**Proposed change.** Arms a per-request timeout (10 s) that deletes the entry and resolves with a
`-32000` timeout error, mirroring `McpStdioClient`'s own `request(method, params, timeoutMs)` which does
exactly this at `orchestrator/src/plugins/index.ts:152-166`.

**Effort.** S.

**How to test it worked.** Call `callMcp('nonexistent/method')` and assert it resolves with an error within
the deadline instead of hanging.

### F9 — A floating promise at boot

**Evidence.** `orchestrator/src/index.ts:20` — `supervisor.startAll();` is an `async` method whose promise is
neither awaited nor caught. The line below it is correct by contrast:
`pluginManager.restore().catch((e) => console.warn(...))` at `:21`. An unhandled rejection here would
surface only as a Bun warning.

**Proposed change.** `await` it in the top-level module (the module is already top-level-await, per `:19`),
or attach a `.catch` that records the failure.

**Effort.** S.

**How to test it worked.** Force `startAll` to reject (make `docker info` throw synchronously) and assert
the failure appears in the log with the service name.

### F10 — The already-fixed pattern still reports one failure at the wrong severity **[K1]**

**Evidence.** `scripts/build-sidecar.ts:70-78` is the fix — a copy failure now warns loudly. Three lines
later the *same kind* of best-effort copy, into the installed app bundle, still reports its failure with
`console.log`:
```95:97:scripts/build-sidecar.ts
	} catch (e: any) {
		console.log(`[build-sidecar] Note: could not write to ${appBundleDir} (${e.message})`);
	}
```
Whereas the two *real* build steps correctly `process.exit(proc.exitCode ?? 1)` at `:49-51` and `:61-63`.

**Proposed change.** `console.warn`, matching the fix above it. Consider one shared
`warn(msg)` helper so the severity convention is enforceable by grep rather than by memory.

**Effort.** XS.

**How to test it worked.** `chmod -w /Applications/Conclave.app/Contents/MacOS` (or point the constant at a
read-only directory in a test) and assert the output line matches `WARNING`.

## 3. Security and supply chain

### S1 — The provider's supply chain is three unpinned moving references **[K4]** **[D]**

**Finding.** The tree documents `ghcr.io/mindflowgo/danyapi:latest` and never pulls it. What it does is
clone a branch, build it from a bare base image, and install seven unversioned packages.

**Evidence.** `orchestrator/src/bootstrap/index.ts:46, 52-54` clones
`https://github.com/mindflowgo/DanyAPI.git` with `--depth 1` and `git pull`s it afterwards;
`orchestrator/src/processes/supervisor.ts:139` runs `docker compose up -d` in that directory. The compose
file that arrives with the clone selects `build: .` and comments the image line out
(`mindflowgo/DanyAPI`, `docker-compose.yml:3-6`), so the build uses that fork's own `Dockerfile`:
`FROM python:3.14-slim` at `:1` (no digest) and `requirements.txt:1-7` — `fastapi`, `uvicorn`,
`httpx[socks]`, `pydantic`, `python-dotenv`, `pillow`, `python-multipart`, **all bare**. `rg 'ghcr'` over
the whole Conclave tree returns three hits, all prose in `ARCHITECTURE.md` (`:72`, `:122`, `:652`).

**Proposed change.** Pin the source to a tag or commit (`git clone --depth 1 --branch <tag>` or a checkout
of a recorded sha), and either pin the fork's `Dockerfile`/`requirements.txt` in a vendored compose file
that Conclave owns, or switch to
`ghcr.io/mindflowgo/danyapi@sha256:<digest>` deliberately. Record the resolved digest in `settings` at
bootstrap so the running artefact is inspectable.

**Effort.** M.

**How to test it worked.** Boot twice with a recorded digest and assert the image id is identical; then
push a commit to a scratch fork and assert the pinned build is unaffected.

### S2 — No Content-Security-Policy, with the global Tauri API exposed

**Evidence.** `client/tauri/src-tauri/tauri.conf.json:46` — `"csp": null` — and `:14` —
`"withGlobalTauri": true`. `tauri.conf.json:52-55` lists two `externalBin`s and
`orchestrator/src/index.ts:83-91` accepts any request with no `Origin` header, so a compromised webview
script has a reachable, unauthenticated local command surface to talk to.

**Proposed change.** Set a restrictive CSP (`default-src 'self'`, `connect-src` limited to
`http://127.0.0.1:4000 ws://127.0.0.1:4000` plus what the UI genuinely needs) and drop
`withGlobalTauri` in favour of the module import the front end already uses in
`client/web/src/lib/services/windowManager.ts`.

**Effort.** M.

**How to test it worked.** Load the built app with the CSP in place and assert the harness still connects
(status pill green) with zero CSP violations in the webview console; then assert an injected inline
`<script>` does not execute.

### S3 — Any setting key can be written, and one of them is a fetch target

**Finding.** `SETTINGS_SET` persists an arbitrary key from any connected client, and `deepseek_endpoint`
is read straight into `fetch` calls.

**Evidence.** `orchestrator/src/index.ts:625-632` — `repos.setSetting(payload.key, String(payload.value))`
with no allowlist and no type check. The value is then used as a base URL at `index.ts:48-56`
(`deleteProviderSessions`) and in the DanyAPI scaffold's
`ctx.setting('deepseek_endpoint', 'http://127.0.0.1:8000/v1')`, so a write to that key redirects the
orchestrator's own outbound requests. The same read also drives `providerManager`'s endpoint everywhere it
is used.

**Proposed change.** Validate keys against a declared settings registry (name, type, default, and whether
it is privileged), reject unknown or malformed values with a `SETTINGS_INVALID` broadcast, and require any
URL-shaped setting to be `127.0.0.1`/`localhost` unless a debug flag is set.

**Effort.** M.

**How to test it worked.** Send `SETTINGS_SET` with `key: "deepseek_endpoint", value: "http://example.com"`,
assert a rejection broadcast and that `repos.getSetting('deepseek_endpoint')` is unchanged.

### S4 — The origin check treats a missing `Origin` as trusted

**Evidence.** `orchestrator/src/index.ts:83-91`:
```83:91:orchestrator/src/index.ts
function isAllowedOrigin(origin: string | null): boolean {
	if (!origin) return true; // Direct tools, CLI, curl, internal connections
	try {
		const parsed = new URL(origin);
		if (parsed.protocol === 'tauri:' || parsed.protocol === 'app:') return true;
		if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === 'tauri.localhost') return true;
	} catch {}
	return false;
}
```
The comment's reasoning is sound for the stdio bridge — which *does* set an explicit
`Origin: http://127.0.0.1:4000` (`orchestrator/bin/mcp-server.js:46`) — but the branch is chosen by the
browser, not by intent, so every non-browser local process is trusted. `ARCHITECTURE.md:626` already names
the DNS-rebinding vector this is meant to close.

**Proposed change.** Issue a per-boot random token, write it to a `0600` file in the data dir, and require
it as a header on `/mcp`, `/api/*` and the WS upgrade; keep the stdio bridge's explicit `Origin` check as a
second gate. This closes the "any local process" gap rather than the browser gap only.

**Effort.** M.

**How to test it worked.** `curl -s http://127.0.0.1:4000/health` (no `Origin`, no token) must be rejected
once the token is required; the app's own harness must still connect.

### S5 — `run_command` executes arbitrary host commands, and its confining root is `process.cwd()`

**Evidence.** `orchestrator/src/mcp/index.ts:249-272` runs `spawnSync('sh', ['-c', cmd])` with the caller's
command verbatim. Simultaneously, the root the tool claims to confine to is
`this.rootDir = process.env.CONCLAVE_PROJECT_ROOT || process.cwd();` at `:37`, and nothing in the tree ever
sets `CONCLAVE_PROJECT_ROOT` — so the value is whatever directory the orchestrator was launched from,
which differs between `tauri dev`, a bundled sidecar, and a manual `bun src/index.ts`. Two other
consequences: `sh` does not exist on Windows, so the tool fails there for a reason unrelated to the
command; and `write_file` has no size limit while `read_file` loads whole files (`:317`).

**Proposed change.** Set `CONCLAVE_PROJECT_ROOT` from the Tauri loader alongside `CONCLAVE_DATA_DIR`
(`client/tauri/src-tauri/src/orchestrator_loader.rs:67-80` already has the hook), fail closed when it is
absent instead of falling back to `process.cwd()`, use `cmd.exe`/`powershell` on Windows, and put a byte
cap on `write_file`.

**Effort.** M.

**How to test it worked.** Boot without `CONCLAVE_PROJECT_ROOT` and assert `run_command` returns a
named config error rather than executing; then boot with it set and assert a command outside the root is
denied.

### S6 — Four lockfiles, two resolution tools, nothing validating either pair **[K3]**

**Finding.** `client/web` carries both a `bun.lock` and an npm `package-lock.json` for the same manifest,
and no command in the repo compares a lockfile to its manifest — so the two can disagree and CI would not
notice, because there is no CI.

**Evidence.** Tracked lockfiles: `client/web/bun.lock` (`lockfileVersion: 1`), `client/web/package-lock.json`
(`lockfileVersion: 3`), `client/tauri/package-lock.json`, `client/tauri/src-tauri/Cargo.lock`. The root
scripts use bun exclusively (`package.json:6-14`), and `client/web/package-lock.json` is npm's artefact for
a bun project. Measured on 2026-10-15: `@lucide/svelte` appears once in `package.json`, once in
`package-lock.json` and **twice** in `bun.lock`. There is no `--frozen-lockfile` invocation anywhere.

**Proposed change.** Delete `client/web/package-lock.json` (or declare npm the resolver for that package
and say so), add a `verify:locks` script that runs `bun install --frozen-lockfile` and
`cargo metadata --locked` and exits 1 on drift, and call it from `build`.

**Effort.** S.

**How to test it worked.** Hand-edit one version in `client/web/package.json`, run `npm run build`, and
assert it fails naming the drift. Today it succeeds and re-resolves.

### S7 — No toolchain pin, and bun is a hard dependency with no floor

**Finding.** The tree declares no `engines`, `packageManager`, `rust-version` or `rust-toolchain.toml`, yet
the backend cannot run under plain Node at all — it uses `bun:sqlite` and `Bun.serve`
(`orchestrator/src/db/index.ts:1`, `orchestrator/src/index.ts:103`) — and the sidecar build shells out to
`rustc -Vv`, throwing when it is missing (`scripts/build-sidecar.ts:22-28`).

**Proposed change.** Add `"engines": { "bun": ">=1.3.14" }` and `"packageManager"` to
`orchestrator/package.json` and the root, and a `rust-toolchain.toml` with the MSRV that
`client/tauri/src-tauri/Cargo.lock` already implies. Fail the sidecar script with a clear message when
`bun --version` is below the floor.

**Effort.** S.

**How to test it worked.** Run the build under a bun older than the declared floor and assert a readable
error before the compile step.

### S8 — `/health` discloses an absolute filesystem path

**Evidence.** `orchestrator/src/index.ts:158-176` returns `bootstrap` verbatim, which includes
`sandboxPath` — an absolute path such as `C:\Users\<name>\AppData\Roaming\dev.revivalist.conclave` — plus
project and tab counts and `process.uptime()`. The endpoint is unauthenticated and reachable by any local
process (S4).

**Proposed change.** Return a boolean and a digest instead of the path, and keep the path behind the
authenticated diagnostics surface.

**Effort.** XS.

**How to test it worked.** `curl -s http://127.0.0.1:4000/health | jq` must contain no drive letter or
home-directory component.

### S9 — Plugin install runs whatever a URL contains

**Evidence.** `orchestrator/src/plugins/index.ts:263-286` clones an arbitrary git URL into the writable
plugins dir and reads its `plugin.json`; `startPlugin` then either spawns `bun run <entrypoint>` as a
child process (`:476-489`) or spawns an MCP stdio server (`:75-79`). The UI wires this directly to a text
input at `client/web/src/routes/(desktop)/settings/+page.svelte` (`installPluginFromUrl`), so a pasted URL
is arbitrary code execution with no confirmation step.

**Proposed change.** Require an explicit confirmation naming the repository and the entrypoint it will run,
record an allowlist of installed plugin origins in `settings`, and refuse a plugin whose `entrypoint` or
`command` escapes its plugin directory. Cheapest useful version: show the resolved manifest in the UI
before `register` is allowed.

**Effort.** M.

**How to test it worked.** Attempt `PLUGIN_INSTALL` with a URL and assert nothing is spawned until a
confirm message with the same id arrives.

## 4. Observability

### O1 — Logging is `console.log` with a hand-rolled tag convention

**Evidence.** Every module logs through `console.*` with a `[Tag]` prefix — `[Bootstrap]`, `[Supervisor]`,
`[Plugins]`, `[Upload]`, `[WebSocket]`, `[DanyAPI]`, `[LlmRouter]`, `[Security]`, `[CLIENT DIAGNOSTIC LOG]`.
There is no level, no timestamp, no machine-readable field, and no file sink or rotation. The provider's
own container has all of it (`DANYAPI_LOG_LEVEL`, `DANYAPI_LOG_FILE`, `DANYAPI_LOG_MAX_BYTES`,
`DANYAPI_LOG_BACKUP_COUNT`), so the outer process is the weaker half of the pair.

**Proposed change.** One tiny logger module emitting `{ts, level, tag, msg, ...fields}` as JSON to stderr,
with `LOG_LEVEL` and an optional file sink. ~60 lines, no dependency.

**Effort.** S.

**How to test it worked.** Boot and assert every line parses as JSON with a level and a timestamp; then
set `LOG_LEVEL=warn` and assert the boot noise disappears.

### O2 — Readiness is one boolean over a moving model list

**Evidence.** `orchestrator/src/providers/danyapi.ts:18-27` returns `res.ok` for `GET /v1/models` and
nothing else; `orchestrator/src/processes/supervisor.ts:223-233` does the same. Neither checks that any
declared model id is present, that `/v1/files` exists, or that the response shape is what the provider
expects. All four coupling risks in [DanyAPI review §6.3](./danyapi-review.md) pass both checks.

**Proposed change.** Extend the probe to assert each declared model id appears in `/v1/models` and that
`/v1/files` answers non-404, and report a per-capability readiness object rather than a boolean.

**Effort.** S.

**How to test it worked.** Run the orchestrator against a stub that serves `GET /v1/models` with an empty
list; assert readiness reports the model-set mismatch instead of `running`.

### O3 — `service_state` is written and never read

**Evidence.** `orchestrator/src/processes/supervisor.ts:262-269` writes a row per service transition into
`service_state`, and `getStatus()` at `:247-261` builds its answer from the **in-memory `Map`**, not from
that table. Nothing else queries `service_state`, so the durable history exists and is unreachable, and a
restart loses the in-memory truth it was meant to complement.

**Proposed change.** Read the last known state from the table on boot so `/health` has a truthful answer
before the first probe completes, and expose the last transition time in `getStatus()`.

**Effort.** S.

**How to test it worked.** Boot with Docker down, assert `/health` reports `failed` immediately rather than
`running`, then start Docker and assert the state changes.

### O4 — No correlation id joins a tab to a provider request

**Evidence.** `[Upload] Saved file X to Y` (`index.ts:283`), `[DanyAPI] <model> tokens used: N`
(`danyapi.ts:147`) and `[WebSocket] Outgoing -> client-... [CHAT_COMPLETE]` (`index.ts:657`) share no
identifier. Reconstructing one user turn from the log means matching on text.

**Proposed change.** Thread the tab id into the provider adapter's log lines and emit one `chatId` field on
every log record touching a turn (which O1's structured logger makes free).

**Effort.** S.

**How to test it worked.** Send one prompt, grep the log for the tab id, and assert every provider, upload
and broadcast line for that turn is returned.

### O5 — The diagnostics endpoint echoes arbitrary client text into the server log

**Evidence.** `orchestrator/src/index.ts:234-241` reads `err` and `msg` from the query string and prints
them verbatim under a `[CLIENT DIAGNOSTIC LOG]` prefix with no length cap. It is reachable by any local
process (S4) and its output looks exactly like a legitimate line, so it can forge log entries.

**Proposed change.** Cap the length, mark the payload as untrusted in O1's structured form, and require the
per-boot token from S4.

**Effort.** XS.

**How to test it worked.** Call it with a 100 KB `msg` containing a newline and `[Upload] Saved file`, and
assert the log contains one record with an escaped payload rather than two lines.

## 5. Developer experience

### D1 — The settings page tells Windows users to paste an author's macOS path

**Evidence.** `client/web/src/routes/(desktop)/settings/+page.svelte:35-36`:
```35:36:client/web/src/routes/(desktop)/settings/+page.svelte
	const PROD_MCP_BIN = '/Applications/Conclave.app/Contents/MacOS/conclave-mcp';
	const DEV_MCP_SCRIPT = '/Users/fil/Code/Conclave/orchestrator/bin/mcp-server.js';
```
Both are rendered into the JSON the UI offers to copy (`mcpConfigJson`) and into the copy-paste "test MCP
connection" command, and neither is derived from anything — no `app.path()`, no build-time substitution.
`/Users/fil/` is not even the author's current path. The same file labels the DanyAPI card with a static
"Docker Active" badge and no binding to `harness.services` (see C3 — this is the UI half of that
happy-path selection), and hardcodes "6 tools".

**Proposed change.** Compute the production binary path from Tauri's `app.path()` at runtime, expose it
via a command, and derive the dev path from the workspace root the loader already resolves. Bind the
DanyAPI badge to `orchestratorSocket.services`.

**Effort.** S.

**How to test it worked.** Build for Windows and assert the copied JSON contains a path that exists on the
machine; stop Docker and assert the badge turns red.

### D2 — Zero tests, no CI

**Evidence.** `rg --files --hidden` over the tree for `test|spec|.github|ci` returns **zero** files, and
`.github/` does not exist. The dependency this tree is built around ships 86 test files under `tests/` plus
three workflows, one of which smoke-tests a built image. So the tree with the hand-written dispatcher and
the JSON-RPC surface has none, and the facade behind it has 90.

**Proposed change.** Start with the cheapest high-value cases, all of which are pure-function or
one-request tests and need no harness: (1) the MCP dispatcher — `initialize`, `tools/list`, an unknown
method, a notification asserting `null`, and a `tools/call` argument-validation case from C4; (2)
`repo.getTabMessages` day-window and fallback behaviour; (3) the id-uniqueness assertion from C7; (4) the
`isAllowedOrigin` table; (5) a `docker compose config` lint in CI if the compose file is ever vendored.
`bun test` is built in, so this needs no dependency.

**Effort.** M.

**How to test it worked.** `bun test` exits 0 and fails loudly when one of the five above is
deliberately broken.

### D3 — The wiki lives in a gitignored directory

> **Line drift, 2026-10-15 — this citation was correct when written.** At commit `595f786`,
> `.gitignore:32` **was** exactly `.cursor/`. Commit `6e257f5` (the one that versioned this project's own
> documentation, hours later) replaced that rule with `.cursor/*` at line 35 and pushed the old line down
> behind a five-line comment. A verifier re-reading this page the same day therefore reported the evidence
> as unreproducible. The finding stands; only the line number moved.
> **The general shape, which is worth more than the correction:** a `file:line` citation is a claim about a
> file that can move, and nothing in this workspace detects the drift. A verifier who trusts the citation
> calls a correct finding wrong; one who distrusts it re-derives everything by hand. Either pin the
> evidence to a commit — "at `595f786`, `.gitignore:32`" — or cite a symbol and a search rather than a
> line, so the claim survives an edit it did not know about.

**Evidence.** `.gitignore:32` is `.cursor/`, and `git check-ignore -v .cursor/documents/conclave.md` resolves
to that rule. Every documentation artefact — `conclave.md`, `conclave-dependency-audit.md`,
`mcp-roadmap.md`, this page and its sibling — is therefore untracked and unversioned, in the repository
whose own docs are the deliverable.

**Proposed change.** Either exclude the wiki from the ignore rule
(`.cursor/*` plus `!.cursor/documents/`) or move it to a tracked `docs/` path and keep the symlinked wiki
pointing there. The deliverables are already treated as durable knowledge; the repository should say so.

**Effort.** S.

**How to test it worked.** `git status --porcelain` after editing a wiki page must list it.

### D4 — Dead code that reads as capability

**Evidence.** Three instances, all in the routing path a reader would trust. `localMockProvider` is defined
in full (`orchestrator/src/providers/mock.ts`) and imported and re-exported at
`orchestrator/src/providers/index.ts:3, 7` but is unreachable, because every branch of `getProvider`
returns `danyApiProvider` (C6). `orchestrator/src/providers/index.ts:18-24` ends with a comment enumerating
four "Future adapters" and then returns DanyAPI anyway, which reads as a fallback and is actually a
catch-all. `client/web/src/routes/api/providers/+server.ts` and
`client/web/src/routes/api/chat/+server.ts` are both hardcoded simulations that report `status: 'online'`
with fixed latencies and stream canned tool steps — the second emits a `[DONE]` terminator for fabricated
content, so a caller cannot distinguish it from a real answer.

**Proposed change.** Delete `mock.ts` or route to it (C6); delete the two fabricated API routes or rename
them to `_mock` and mark them unreachable in the UI.

**Effort.** S.

**How to test it worked.** `rg -n 'localMockProvider'` returns either zero hits or a hit in a live branch;
the provider list in the UI contains only providers whose adapter exists.

### D5 — Four overlapping documents cover the DanyAPI coupling

**Evidence.** `ARCHITECTURE.md:40-44, 66, 72, 121-122, 190, 274-275, 301, 309, 321, 368, 608-617, 651-652` restates the same
coupling in prose, and `conclave.md` §5, `conclave-dependency-audit.md` and
[danyapi-review.md](./danyapi-review.md) each restate part of it. `ARCHITECTURE.md:368` and `:122` are the
two live copies of the `:latest` claim that nothing implements (S1).

**Proposed change.** Make the review page the single source for the coupling and reduce the others to
links, so the next reader cannot pick up the stale `:latest` sentence as fact. `index.md` is the caller's
to update.

**Effort.** S.

**How to test it worked.** `rg 'ghcr\.io'` returns either zero hits or hits that link to the review page.

## 6. Performance

### P1 — N+1 queries in the message read path

**Evidence.** `orchestrator/src/db/index.ts:195-210` runs one `SELECT * FROM tool_steps WHERE message_id = ?`
per assistant message inside the loop, on a window of up to 50 messages (the fallback at `:183-190`) or an
unbounded day range. Each iteration also re-parses JSON columns inline.

**Proposed change.** One query over the message ids (`WHERE message_id IN (...)`) followed by a group-by in
JS, and a short-lived cache keyed on the tab's `updated_at`.

**Effort.** S.

**How to test it worked.** Seed 50 messages with two steps each, and assert both query count and wall time
fall — the count is observable by wrapping `db.query`.

### P2 — Whole-file reads and writes with no cap

**Evidence.** `orchestrator/src/mcp/index.ts:317` — `readFileSync(filePath, 'utf-8')` with no size check;
`:344` — `writeFileSync` with no cap; `:269` — `maxBuffer: 10 * 1024 * 1024` on `run_command`. A 2 GB file
is read into a string and returned as an MCP content block.

**Proposed change.** Stat before read, refuse over a configurable limit (1 MB is a sane default for a tool
result), and truncate with an explicit marker naming the byte count.

**Effort.** S.

**How to test it worked.** Point `read_file` at a large file and assert a refusal or a truncated result
with the limit named, and that memory does not spike.

### P3 — Startup latency is serialised polling

**Evidence.** `isDockerRunning()` (`supervisor.ts:50-60`) allows 5 s for `docker info`; the health poll is
10 × 1 s (`:157-161`); `waitHealthy` for Bun plugins is 500 ms × 15 s (`plugins/index.ts:581-590`);
`pingService` allows 2 s per attempt (`:223-233`). These run in sequence per service, and `startAll` does not
`await` (F9).

**Proposed change.** Trim the timeouts to what the operations need, and poll concurrently with an
`AbortSignal`. Nothing here needs a second per iteration on a local socket.

**Effort.** S.

**How to test it worked.** Measure time from process start to `SERVER_READY` with Docker up and down; assert
it drops in both cases.

### P4 — The model list is computed once and never refreshed

**Evidence.** `orchestrator/src/index.ts:64` — `export const AVAILABLE_MODELS = getAllAvailableModels();` at
module load. If DanyAPI starts later — a normal sequence, since it is a container that takes seconds and is
launched in parallel — the first `LOAD_SETTINGS` can carry a list the UI then treats as complete.
`pluginManager.list()` re-derives plugin models on demand (`plugins/index.ts:222-260`), so the two sources
disagree about freshness.

**Proposed change.** Make `AVAILABLE_MODELS` a function, or refresh it when the plugin set or a service
state changes, and broadcast `MODELS_UPDATED` on change.

**Effort.** S.

**How to test it worked.** Start the orchestrator with DanyAPI stopped, then start DanyAPI, and assert the UI
list gains the models without a reload.

### P5 — Manifests re-parsed on every call

**Evidence.** `pluginManager.list()` parses `row.manifest` JSON once per plugin per call
(`plugins/index.ts:236-240`) and again inside `callTool` (`:398-399`, `:418-419`) and `listMcpTools`
(`:336-370`), and `list()` is called on every `PLUGIN_LIST`. `DanyApiProvider.isAvailable()` builds a fresh
request per call with no memoisation (`danyapi.ts:18-27`).

**Proposed change.** Parse once into a `Map<id, PluginManifest>` invalidated on
`upsertPlugin`/`deletePlugin`, and memoise the availability probe for a couple of seconds.

**Effort.** S.

**How to test it worked.** Call `PLUGIN_LIST` 100 times and assert the JSON parse count is bounded by the
number of manifest changes, not the number of calls.

## 7. What is already good

Stated so the list above reads as a signal rather than a complaint.

- **The sidecar build is now correct.** `scripts/build-sidecar.ts` exits non-zero and prints the compiler
  output on either *real* build failure (`:49-51`, `:61-63`), and the convenience copy that used to fail
  silently now warns with the source and destination named (`:74-78`). This is the reference fix for **[K1]**
  and it is why the other nine instances are worth finding.
- **The two silent rename pairs are documented.** `externalBin` ↔ `build-sidecar.ts` and the
  Rust-written/env-read `CONCLAVE_DATA_DIR` are recorded with their failure modes in
  [conclave.md §4.2](./conclave.md), and `orchestrator_loader.rs:67-80` sets the data dir from Tauri's
  `app_data_dir()` rather than guessing.
- **The WebSocket transport is genuinely well built.** `client/tauri/src-tauri/src/orchestrator_ws.rs`
  implements capped exponential backoff (`:18-19`, `:74-88`), re-queues payloads that a dead writer never
  flushed (`:118-137`), bounds the queue at 64 (`:21`), answers pings explicitly because a split sink
  does not (`:155-158`), and exposes a forced reconnect via an abort handle (`:216-222`). The offline queue
  is the source of F1, but the transport itself is not the problem.
- **MCP responses to notifications are handled correctly.** `handleJsonRpc` returns `null` for
  `notifications/initialized` and `notifications/cancelled` and for any notification, and
  `orchestrator/src/index.ts:135-141` turns that into a proper `204`. That is the detail most hand-written
  MCP servers get wrong.
- **Unknown events are rejected, not ignored.** `orchestrator/src/index.ts:635-638` — the `default` case in
  the WS switch broadcasts an `ERROR` naming the unknown type. This is the *opposite* of **[K2]**, and it is
  the model C4 should follow.
- **The window-position logic is defensive.** `client/tauri/src-tauri/src/lib.rs` clamps both windows back
  onto a visible monitor when the saved coordinates land off-screen, for both the overlay (`:56-83`) and the
  main window (`:85-115`), and the state is persisted on move events. Small, correct, and the sort of thing
  that usually gets skipped.
- **The plugin architecture has real ideas in it.** Longest-prefix tool routing so two plugin ids cannot
  misroute (`plugins/index.ts:443-446`), a per-request timeout in the stdio client
  (`:152-166`), and scaffolds that are re-seeded into a writable directory while user edits persist
  (`:188-194`).
- **`Promise` handling at boot is mostly right.** `pluginManager.restore().catch(...)` at
  `orchestrator/src/index.ts:21` logs a failure with the plugin id; only F9's `supervisor.startAll()` is
  unguarded.
- **The snapshot the tree depends on is a well-engineered project** — non-root container, digest-pinned
  base, SHA-pinned CI actions with a real image smoke test, 86 test files, and `.env.example`
  cross-checked against `config.py` by a test. Details in
  [DanyAPI review §7](./danyapi-review.md).

## 8. Ranking by value-to-effort

Cheap first, within each band by the risk it retires. Value is "what stops being wrong for a user";
effort is S/M/L as estimated above.

| # | Item | Pattern | Effort | Value | Why it sits here |
|---|---|---|---|---|---|
| 1 | **D1** — de-hardcode the MCP paths in settings | — | S | High | Two string literals; every Windows user is currently given a path that cannot exist, and the "test connection" command fails with it |
| 2 | **F6** — log plugin bus handler failures | **[K1]** | XS | High | Three lines converts a whole class of silent window staleness into a log line |
| 3 | **F10** — `console.warn` on the app-bundle copy failure | **[K1]** | XS | Medium | Matches the fix directly above it; removes the last silent swallow in the build script |
| 4 | **S8** — stop returning `sandboxPath` from `/health` | — | XS | Medium | One field; removes an absolute home path from an unauthenticated endpoint |
| 5 | **O5** — cap and mark the diagnostics echo | — | XS | Medium | Trivial, and it closes a log-forging path into the surface the whole page wants people to trust |
| 6 | **C1** — fix the session teardown path | **[K1]** | S | High | One string; a documented feature has never worked, and the check is two curls |
| 7 | **C2** — make `danyApiReady` mean something | **[K1]** | S | High | Removes the first of two stacked lies about the provider |
| 8 | **C3** — verify before claiming `running` | **[K1]** | S | High | Removes the second; together with C2 the engine indicator becomes truthful |
| 9 | **F1** — client-side response deadline | **[K1]** | S | High | The most user-visible failure on the page: an indefinite spinner |
| 10 | **F2** — stop discarding malformed stream lines | **[K1]** | S | High | A truncated answer currently looks like a complete one — **done 2026-10-15** |
| 11 | **C5** — separator-aware path confinement | **[K1]** | S | High | A security control that reads as present and is not; the test is two paths |
| 12 | **C8** — cap uploads, uniquify names | — | S | Medium | Data loss on a repeated filename, and unbounded disk on a large body |
| 13 | **C9** — stop rewriting the upload model | — | S | Medium | One line; the correct behaviour already exists in the adapter |
| 14 | **C7** — collision-proof ids | — | S | Medium | Low probability, total failure when it fires, and `nextSeq` already exists |
| 15 | **S6** — delete the duplicate lockfile, add a drift check | **[K3]** | S | High | Nine lines of script retires a whole failure class, and two resolvers for one manifest is a live hazard |
| 16 | **S7** — declare the toolchain floor | **[K4]** | S | Medium | Cheap, and it is the one unpinned thing that is entirely under this repo's control |
| 17 | **D3** — make the wiki tracked | — | S | Medium | The deliverables are unversioned for no reason — **done at `6e257f5`** |
| 18 | **D2** — start the test suite with five cheap cases | — | M | High | The tree with a hand-written JSON-RPC dispatcher has zero tests; `bun test` is built in |
| 19 | **O1** — structured logger | — | S | Medium | Unblocks O4 and makes every later fix diagnosable |
| 20 | **O2** — capability-level readiness | — | S | High | The only check that would have caught every coupling risk in [the review](./danyapi-review.md) §6 |
| 21 | **F4** — log a failed provider `git pull` | **[K1]** | S | Medium | Provider drift is currently unobservable |
| 22 | **F5** — log dropped plugin frames | **[K1]** | S | Medium | Same shape, one level down the stack |
| 23 | **F7** — 404 is not healthy | — | S | Medium | Prevents a plugin from advertising tools that cannot answer |
| 24 | **F8** — timeout `callMcp` | — | S | Medium | A leaked map and a promise that never settles; the server-side client already solves it |
| 25 | **F9** — handle the `startAll` promise | — | S | Low | Correctness of a boot path, one line |
| 26 | **F3** — flag an errored assistant message | — | S | Medium | Keeps the durable record honest — **done 2026-10-15** |
| 27 | **C4** — validate MCP arguments against the schema | **[K2]** | M | High | The advertised contract becomes enforceable, and the failure shape already exists |
| 28 | **S1** — pin the provider supply chain | **[K4]** | M | High | Three moving references currently decide what code runs in the container |
| 29 | **D4** — remove or route the dead paths | — | S | Medium | Four files that read as capability and are not |
| 30 | **C6** — data-drive the provider list | — | M | High | Stops the UI offering models that cannot work |
| 31 | **S3** — validate setting writes | — | M | High | One unvalidated key currently redirects the orchestrator's own requests |
| 32 | **S4** — per-boot token on the local surface | — | M | High | Closes "any local process" rather than the browser gap only |
| 33 | **S5** — set and require `CONCLAVE_PROJECT_ROOT`, cross-platform shell | — | M | High | A host-execution tool whose confinement root is `process.cwd()`; the loader hook already exists |
| 34 | **S2** — set a CSP and drop `withGlobalTauri` | — | M | Medium | Real, but its exploitability depends on S3/S5 first |
| 35 | **P1** — collapse the N+1 | — | S | Medium | Bounded by 50 rows today; do it when the log work lands |
| 36 | **P4** — refresh the model list | — | S | Medium | Fixes a startup race that currently needs a reload |
| 37 | **P2** — cap `read_file`/`write_file` | — | S | Medium | Cheap memory guard |
| 38 | **P5** — memoise manifest parsing | — | S | Low | Only matters at high `PLUGIN_LIST` rates |
| 39 | **P3** — trim startup polling | — | S | Low | Latency only, and mostly invisible next to a container start |
| 40 | **S9** — confirm before executing a plugin | — | M | Medium | Depends on S4 making the surface reachable only by the app |
| 41 | **O3** — read `service_state` on boot | — | S | Medium | Makes `/health` truthful before the first probe; pairs with C3 |
| 42 | **O4** — correlate a turn in the log | — | S | Medium | Free once O1 exists |
| 43 | **D5** — collapse the four DanyAPI documents | — | S | Low | Documentation hygiene; prevents the stale `:latest` claim being read as fact |

**The five to do first, by value-to-effort:** **D1**, **F6**, **C1**, **C2** + **C3** (they are one fix to
one indicator and should ship together), and **S6**. All five are S-or-smaller, all five have a
two-request or one-assertion test, and together they retire four **[K1]** instances and the single
**[K3]** pair.

## 9. Related

- [DanyAPI review](./danyapi-review.md) — the provider end of items marked **[D]** here
- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — the two silent identifier pairs
  §7 credits, and the `crates/` omission
- [Conclave dependency audit](./conclave-dependency-audit.md) — the declared dependency baseline S6 and S7
  extend
- [Conclave MCP layer roadmap](./mcp-roadmap.md) — the protocol work C4 sits in front of
- [Documentation map](./index.md) — the map this page hangs from
