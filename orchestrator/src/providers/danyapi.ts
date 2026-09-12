import type { ModelDescriptor, ProviderAdapter, ProviderChatOptions, ProviderStreamChunk } from './types';
import { repos } from '../db';

export const DANYAPI_MODELS: ModelDescriptor[] = [
	{ id: 'deepseek-v4-flash', name: 'Deepseek v4', description: 'Fast reasoning & chat' },
	{ id: 'deepseek-v4-flash-thinking', name: 'DeepSeek V4 Thinking', description: 'Deep thinking reasoning process' },
	{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'High capability deep model' },
	{ id: 'deepseek-v4-pro-thinking', name: 'DeepSeek V4 Pro Thinking', description: 'Maximum reasoning & reflection' },
	{ id: 'qwen3.7-plus', name: 'Qwen 3.7 Plus', description: 'Multimodal & vision analysis' },
	{ id: 'qwen3.8-max', name: 'Qwen 3.8 Max', description: 'Frontier multimodal coder' }
];

export class DanyApiProvider implements ProviderAdapter {
	public readonly name = 'DanyAPI';
	public readonly models = DANYAPI_MODELS;
	private readonly baseUrl = 'http://127.0.0.1:8000/v1';

	public async isAvailable(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/models`, {
				method: 'GET',
				headers: { 'Host': 'localhost' }
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	public async uploadFile(
		fileBuffer: Buffer | ArrayBuffer,
		filename: string,
		sessionId: string,
		mimeType = 'application/octet-stream',
		model?: string
	): Promise<any> {
		const effectiveModel = model || this.models[0].id;

		const formData = new FormData();
		const blob = new Blob([fileBuffer], { type: mimeType });
		formData.append('file', blob, filename);
		formData.append('session_id', sessionId);
		formData.append('model', effectiveModel);

		const res = await fetch(`${this.baseUrl}/files`, {
			method: 'POST',
			headers: { 'Host': 'localhost' },
			body: formData
		});

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`DanyAPI file upload failed (${res.status}): ${errText}`);
		}

		return await res.json();
	}

	public async *streamChat(options: ProviderChatOptions): AsyncGenerator<ProviderStreamChunk> {
		const { message, messages, attachments, model, sessionId, chatId, temperature, maxTokens } = options;
		const effectiveSessionId = sessionId || chatId;

		// 1. Resolve model directly from options or plugin default:
		const effectiveModel = model || this.models[0].id;
		const modelMeta = this.models.find((m) => m.id === effectiveModel);
		const modelDisplayName = modelMeta ? modelMeta.name : effectiveModel;

		// 2. Format prompt message with attachments reference if present
		let effectiveUserPrompt = message;
		if (attachments && attachments.length > 0) {
			const fileNotes = attachments.map((a) => `${a.name}${a.filepath ? ` (${a.filepath})` : ''}`).join(', ');
			effectiveUserPrompt = `[Attached files: ${fileNotes}]\n\n${message}`;
		}

		// 3. Build request payload with model and session_id
		const requestBody: Record<string, any> = {
			model: effectiveModel,
			messages: messages && messages.length > 0
				? messages.map((m) => ({ role: m.role, content: m.content }))
				: [{ role: 'user', content: effectiveUserPrompt }],
			stream: true,
			temperature: temperature ?? 0.7,
			max_tokens: maxTokens ?? 4096,
			session_id: effectiveSessionId,
			stream_options: {
				include_usage: true
			}
		};

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 60000);

		try {
			const res = await fetch(`${this.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Host': 'localhost'
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (!res.ok || !res.body) {
				const errText = await res.text();
				throw new Error(`DanyAPI chat completions returned status ${res.status}: ${errText}`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) continue;
					const jsonStr = trimmed.slice(6).trim();
					if (jsonStr === '[DONE]') continue;

					try {
						const parsed = JSON.parse(jsonStr);

						// Handle DanyAPI/DeepSeek stream errors
						if (parsed.error) {
							const errMsg = parsed.error.message || parsed.error.detail || JSON.stringify(parsed.error);
							throw new Error(`DeepSeek error: ${errMsg}`);
						}
						if (parsed.detail) {
							throw new Error(`DeepSeek error: ${parsed.detail}`);
						}

						// Handle incremental token delta
						const token = parsed.choices?.[0]?.delta?.content || '';
						if (token) {
							yield { type: 'token', token };
						}

						// Pull total tokens for DanyAPI
						if (parsed.usage) {
							const totalTokens =
								parsed.usage.total_tokens ??
								((parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0)) ??
								parsed.usage.total;
							if (typeof totalTokens === 'number') {
								console.log(`[DanyAPI] ${modelDisplayName} tokens used: ${totalTokens}`);
								yield { type: 'usage', totalTokens, usage: parsed.usage, model: effectiveModel };
							}
						}
					} catch (err: any) {
						if (err.message?.includes('DeepSeek error:')) throw err;
					}
				}
			}
		} catch (err: any) {
			clearTimeout(timeoutId);
			throw err;
		}
	}
}

export const danyApiProvider = new DanyApiProvider();

