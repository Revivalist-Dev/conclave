// Probe for the F2 fix in src/providers/danyapi.ts.
//
// DanyApiProvider's baseUrl is a hardcoded private field pointing at
// http://127.0.0.1:8000/v1, so the cheapest faithful stub is a real HTTP server
// bound to that exact address: no monkey-patching, no signature change.
//
//   bun probe-f2-stream.ts <case> [modulePath]
//
// <case> is one of: malformed | truncated | doneOnly | clean | cleanNoUsage |
// deepseekError | malformedThenGood
// modulePath defaults to ./src/providers/danyapi, and can point at a copy of the
// pre-fix module to compare "before" against "after". To reproduce the baseline:
//
//   git show HEAD:orchestrator/src/providers/danyapi.ts > orchestrator/src/providers/danyapi.prefix.ts
//   cd orchestrator
//   bun probe-f2-stream.ts malformed ./src/providers/danyapi.prefix

const CASE = process.argv[2] ?? 'malformed';
const MODULE_PATH = process.argv[3] ?? './src/providers/danyapi';

const BODIES: Record<string, string> = {
	// A malformed line, then a clean terminator: 1 discarded line, 0 usable chunks.
	malformed: 'data: {not json}\ndata: [DONE]\n\n',
	// Cut mid-chunk, no terminator, nothing parseable: the truncation signature.
	truncated: 'data: {"choices":[{"delta":{"content":"partial',
	// A clean, legitimate, empty completion.
	doneOnly: 'data: [DONE]\n\n',
	// The normal path: two tokens, one usage frame, a terminator.
	clean:
		'data: {"choices":[{"delta":{"content":"hi"}}]}\n' +
		'data: {"choices":[{"delta":{"content":" there"}}]}\n' +
		'data: {"usage":{"total_tokens":7}}\n' +
		'data: [DONE]\n\n',
	// Tokens only, no usage frame, terminator present.
	cleanNoUsage: 'data: {"choices":[{"delta":{"content":"ok"}}]}\ndata: [DONE]\n\n',
	// The load-bearing upstream error frame: must still rethrow, and must NOT warn.
	deepseekError: 'data: {"detail":"boom"}\ndata: [DONE]\n\n',
	// One bad line plus one good one: warn, but the response is not a failure.
	malformedThenGood:
		'data: {not json}\n' +
		'data: {"choices":[{"delta":{"content":"salvaged"}}]}\n' +
		'data: [DONE]\n\n'
};

if (!(CASE in BODIES)) {
	console.error(`unknown case '${CASE}'; expected one of ${Object.keys(BODIES).join(', ')}`);
	process.exit(2);
}

const server = Bun.serve({
	port: 8000,
	hostname: '127.0.0.1',
	fetch() {
		return new Response(BODIES[CASE], {
			status: 200,
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}
});

const { DanyApiProvider } = await import(MODULE_PATH);
const provider = new DanyApiProvider();

const chunks: any[] = [];
let error: string | null = null;

try {
	for await (const chunk of provider.streamChat({
		conversationId: 'probe',
		chatId: 'probe',
		sessionId: 'probe',
		message: 'ping'
	})) {
		chunks.push(chunk);
	}
} catch (err: any) {
	error = err.message;
}

console.log(`\n[probe] case=${CASE} module=${MODULE_PATH}`);
console.log(`[probe] chunks=${JSON.stringify(chunks)}`);
console.log(`[probe] error=${error === null ? 'null' : error}`);

server.stop(true);
