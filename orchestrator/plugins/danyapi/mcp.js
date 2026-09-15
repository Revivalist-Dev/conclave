// DanyAPI MCP scaffold: implements ask_deepseek / ask_qwen / ask_zai
// by calling the DanyAPI OpenAI-compatible endpoint. Runs inside orchestrator.
export async function call(toolName, args, ctx) {
	const tool = String(toolName || '').toLowerCase();
	let tabName = 'default';
	let model = ctx.setting('deepseek_model', 'deepseek-v4-flash');

	if (tool.includes('qwen')) {
		tabName = 'qwen';
		model = ctx.setting('qwen_model', 'qwen3.7-plus');
	} else if (tool.includes('deepseek')) {
		tabName = 'deepseek';
		model = ctx.setting('deepseek_model', 'deepseek-v4-flash');
	} else if (tool.includes('zai')) {
		tabName = 'zai';
		model = ctx.setting('zai_model', 'zai');
	} else {
		tabName = tool.replace(/^plugin_[^_]+_/, '').replace(/^ask_/, '') || 'default';
	}

	const question = String(args?.question || '').trim();
	if (!question) {
		return {
			content: [{ type: 'text', text: 'No question provided.' }],
			isError: true,
			tab_name: tabName,
			tool_name: toolName
		};
	}

	const thread = ctx.getOrCreateThread(tabName);
	const sessionId = String(args?.session_id || thread.id);
	const endpoint = ctx.setting('deepseek_endpoint', 'http://127.0.0.1:8000/v1');

	ctx.addMessage(thread.id, 'user', question, model);

	let res;
	try {
		res = await fetch(`${endpoint}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: question }],
				session_id: sessionId
			})
		});
	} catch (fetchErr) {
		const errDetail = `Failed to reach DanyAPI at ${endpoint}: ${fetchErr?.message || String(fetchErr)}`;
		ctx.addMessage(thread.id, 'assistant', `> ${errDetail}`, model);
		return {
			content: [{ type: 'text', text: errDetail }],
			isError: true,
			tab_name: tabName,
			tool_name: toolName
		};
	}

	if (!res.ok) {
		const errMsg = `DanyAPI responded ${res.status}`;
		ctx.addMessage(thread.id, 'assistant', `> ${errMsg}`, model);
		return {
			content: [{ type: 'text', text: errMsg }],
			isError: true,
			tab_name: tabName,
			tool_name: toolName
		};
	}

	const data = await res.json();
	const answer = data?.choices?.[0]?.message?.content || JSON.stringify(data).slice(0, 2000);
	ctx.addMessage(thread.id, 'assistant', answer, model);

	return {
		content: [{ type: 'text', text: answer }],
		tab_name: tabName,
		tool_name: toolName
	};
}
