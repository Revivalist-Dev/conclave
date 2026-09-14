// DanyAPI MCP scaffold: implements ask_deepseek / ask_qwen by calling the
// DanyAPI OpenAI-compatible endpoint. Runs inside the orchestrator.
// (Seeded into <data>/plugins/danyapi/mcp.js at boot; this checked-in copy is
//  the editable source of truth — re-seed by deleting the seeded file.)
export async function call(toolName, args, ctx) {
	var question = String((args && args.question) || '').trim();
	if (!question) return { content: [{ type: 'text', text: 'No question provided.' }], isError: true };
	var sessionId = String((args && args.session_id) || 'default');
	var endpoint = ctx.setting('deepseek_endpoint', 'http://127.0.0.1:8000/v1');
	var model = toolName === 'ask_qwen' ? 'qwen3.7-plus' : ctx.setting('deepseek_model', 'deepseek-v4-flash');

	// One shared MCP thread: created if missing, reused afterwards.
	var thread = ctx.getOrCreateThread('MCP');
	ctx.addMessage(thread.id, 'user', question, model);

	var res = await fetch(endpoint + '/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: model, messages: [{ role: 'user', content: question }], session_id: sessionId })
	});
	if (!res.ok) {
		var errMsg = 'DanyAPI responded ' + res.status;
		ctx.addMessage(thread.id, 'assistant', '> ' + errMsg, model);
		return { content: [{ type: 'text', text: errMsg }], isError: true };
	}
	var data = await res.json();
	var answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || JSON.stringify(data).slice(0, 2000);
	ctx.addMessage(thread.id, 'assistant', answer, model);
	return { content: [{ type: 'text', text: answer }] };
}
