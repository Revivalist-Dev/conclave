import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const defaultProviders = [
		{
			id: 'deepseek',
			name: 'DeepSeek (DanyAPI)',
			type: 'deepseek',
			endpoint: 'http://localhost:8000/v1',
			models: [
				'deepseek-v4-flash',
				'deepseek-v4-flash-thinking',
				'deepseek-v4-pro',
				'deepseek-v4-pro-thinking',
				'deepseek-v4-vision',
				'qwen3.7-plus',
				'qwen3.8-max'
			],
			activeModel: 'deepseek-v4-flash',
			status: 'online',
			latency: 18,
			isLocal: true
		},
		{
			id: 'claude',
			name: 'Claude',
			type: 'claude',
			models: ['Claude Opus 5 High', 'Claude 3.7 Sonnet', 'Claude 3.5 Haiku'],
			activeModel: 'Claude Opus 5 High',
			status: 'online',
			latency: 42
		},
		{
			id: 'ollama',
			name: 'Ollama',
			type: 'ollama',
			endpoint: 'http://localhost:11434',
			models: ['Llama 3.3 70B', 'DeepSeek R1 14B', 'Qwen 2.5 Coder 32B', 'Gemma 2 9B'],
			activeModel: 'Llama 3.3 70B',
			status: 'online',
			latency: 12
		},
		{
			id: 'lmstudio',
			name: 'LM Studio',
			type: 'lmstudio',
			endpoint: 'http://localhost:1234/v1',
			models: ['Qwen 2.5 Coder 32B', 'DeepSeek Coder V2', 'Phi 4 Mini'],
			activeModel: 'Qwen 2.5 Coder 32B',
			status: 'online',
			latency: 8
		},
		{
			id: 'vllm',
			name: 'vLLM Local',
			type: 'vllm',
			endpoint: 'http://localhost:8000/v1',
			models: ['Mistral Large 2', 'Llama 3.1 8B Instruct'],
			activeModel: 'Mistral Large 2',
			status: 'offline'
		},
		{
			id: 'custom',
			name: 'Bun Local Router',
			type: 'custom',
			endpoint: 'http://localhost:3000/api/chat',
			models: ['Local Fast Router', 'Custom Engine'],
			activeModel: 'Local Fast Router',
			status: 'online',
			latency: 3
		}
	];

	return new Response(JSON.stringify({ providers: defaultProviders }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
