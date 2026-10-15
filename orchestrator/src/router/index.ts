import { repos } from '../db';
import { getProvider, localMockProvider } from '../providers';

export interface AttachmentItem {
	id?: string;
	name: string;
	size?: number;
	filepath?: string;
	mimeType?: string;
}

export interface ChatRequest {
	tabId: string;
	message: string;
	attachments?: AttachmentItem[];
	messages?: Array<{ role: string; content: string }>;
	provider?: string;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface StreamEvent {
	type: 'token' | 'usage' | 'tool_step' | 'complete' | 'error';
	data: any;
}

export class LlmRouter {
	public async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
		const { tabId, message, attachments, provider = 'DeepSeek', model } = req;

		// 1. Record user message in SQLite
		repos.addMessage(tabId, 'user', message, attachments, model);

		// 2. Select modular provider adapter (e.g. DanyAPI)
		const providerAdapter = getProvider(provider);
		let fullResponse = '';
		let totalTokens: number | undefined;
		let providerError = false;

		try {
			for await (const chunk of providerAdapter.streamChat({
				conversationId: tabId,
				chatId: tabId,
				sessionId: tabId,
				message,
				messages: req.messages,
				attachments,
				model,
				temperature: req.temperature,
				maxTokens: req.maxTokens
			})) {
				if (chunk.type === 'token' && chunk.token) {
					fullResponse += chunk.token;
					yield { type: 'token', data: { token: chunk.token, tabId } };
				} else if (chunk.type === 'usage' && typeof chunk.totalTokens === 'number') {
					totalTokens = chunk.totalTokens;
					yield { type: 'usage', data: { totalTokens, tabId, model: chunk.model || model } };
				} else if (chunk.type === 'tool_step') {
					yield { type: 'tool_step', data: chunk.toolStep };
				}
			}
		} catch (err: any) {
			providerError = true;
			const rawMsg = err.message || 'Unknown error occurred';
			let cleanError = rawMsg;
			try {
				const jsonMatch = rawMsg.match(/\{.*?\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					cleanError = parsed.detail || parsed.error?.message || parsed.error || cleanError;
				}
			} catch {}

			console.error(`[LlmRouter] Provider ${providerAdapter.name} error: ${cleanError}`);

			const errorNotice = `**${providerAdapter.name} Error**: ${cleanError}`;
			const errorChunk = fullResponse ? `\n\n> ${errorNotice}` : `> ${errorNotice}`;
			fullResponse += errorChunk;

			yield { type: 'token', data: { token: errorChunk, tabId } };
			yield { type: 'error', data: { error: cleanError, tabId } };
		}

		// 3. Save assistant message and update tab
		const assistantMsg = repos.addMessage(
			tabId,
			'assistant',
			fullResponse,
			undefined,
			model,
			totalTokens ? { totalTokens } : undefined,
			providerError ? { error: true } : undefined
		);

		// Update tab's last response snippet
		repos.updateTabLastResponse(tabId, providerError ? '⚠ Provider error' : fullResponse.slice(0, 200), model);

		yield {
			type: 'complete',
			data: {
				tabId,
				messageId: assistantMsg.id,
				totalTokens,
				model
			}
		};
	}
}

export const llmRouter = new LlmRouter();

