/**
 * Built-in plugins: shipped with the orchestrator, registered into the plugin
 * registry at every boot (the user's enabled/disabled choice is preserved).
 * The DanyAPI plugin mirrors the checked-in files at orchestrator/plugins/danyapi/
 * (plugin.json + mcp.js) — its backend has no MCP server of its own, so its MCP
 * abilities are scaffolded as JavaScript here and seeded into the writable
 * plugin directory at boot, where the orchestrator loads and runs them.
 */

import type { PluginManifest } from './index';

export type BuiltinPlugin = PluginManifest & { files?: Record<string, string> };

// Scaffold source. Deliberately template-literal-free so it embeds cleanly.
const DANYAPI_MCP_JS = `// DanyAPI MCP scaffold: implements ask_deepseek / ask_qwen by calling the
// DanyAPI OpenAI-compatible endpoint. Runs inside the orchestrator.
export async function call(toolName, args, ctx) {
	var question = String((args && args.question) || '').trim();
	if (!question) return { content: [{ type: 'text', text: 'No question provided.' }], isError: true };
	var sessionId = String((args && args.session_id) || 'default');
	var endpoint = ctx.setting('deepseek_endpoint', 'http://127.0.0.1:8000/v1');
	var model = toolName === 'ask_qwen' ? 'qwen3.7-plus' : ctx.setting('deepseek_model', 'deepseek-v4-flash');

	// One shared MCP thread: created if missing, reused afterwards.
	var thread = ctx.getOrCreateThread('MCP');
	ctx.addMessage(thread.id, 'user', question, model);

	var res;
	try {
		res = await fetch(endpoint + '/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: model, messages: [{ role: 'user', content: question }], session_id: sessionId })
		});
	} catch (fetchErr) {
		var errDetail = 'Failed to reach DanyAPI at ' + endpoint + ': ' + (fetchErr && fetchErr.message ? fetchErr.message : String(fetchErr));
		ctx.addMessage(thread.id, 'assistant', '> ' + errDetail, model);
		return { content: [{ type: 'text', text: errDetail }], isError: true };
	}

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
`;

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
	{
		id: 'danyapi',
		name: 'DanyAPI',
		version: '0.1.0',
		type: 'docker',
		serviceName: 'DanyAPI',
		port: 8000,
		mcp: {
			scaffold: 'mcp.js',
			tools: [
				{
					name: 'ask_deepseek',
					description:
						'Ask DeepSeek (via DanyAPI) a question. Uses the shared MCP thread; the session_id is forwarded to DanyAPI.',
					inputSchema: {
						type: 'object',
						properties: {
							question: { type: 'string', description: 'The question to ask' },
							session_id: { type: 'string', description: 'Provider-side session id (default: "default")' }
						},
						required: ['question']
					}
				},
				{
					name: 'ask_qwen',
					description:
						'Ask Qwen (via DanyAPI) a question. Uses the shared MCP thread; the session_id is forwarded to DanyAPI.',
					inputSchema: {
						type: 'object',
						properties: {
							question: { type: 'string', description: 'The question to ask' },
							session_id: { type: 'string', description: 'Provider-side session id (default: "default")' }
						},
						required: ['question']
					}
				}
			]
		},
		models: [
			{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
			{ id: 'deepseek-v4-flash-thinking', name: 'DeepSeek V4 Flash (Thinking)' },
			{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
			{ id: 'deepseek-v4-pro-thinking', name: 'DeepSeek V4 Pro (Thinking)' },
			{ id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus' },
			{ id: 'qwen3.8-max', name: 'Qwen 3.8 Max' }
		],
		files: { 'mcp.js': DANYAPI_MCP_JS }
	}
];
