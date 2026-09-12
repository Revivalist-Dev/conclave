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
	conversationId?: string;
	chatId?: string;
	sessionId?: string;
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
		const effectiveTabId = req.tabId || req.conversationId || req.chatId || req.sessionId || '';
		const { message, attachments, provider = 'DeepSeek', model } = req;

		// 1. Record user message in SQLite
		repos.addMessage(effectiveTabId, 'user', message, attachments, model);

		// 2. Select modular provider adapter (e.g. DanyAPI)
		const providerAdapter = getProvider(provider);
		let fullResponse = '';
		let totalTokens: number | undefined;

		try {
			for await (const chunk of providerAdapter.streamChat({
				conversationId: effectiveTabId,
				chatId: effectiveTabId,
				sessionId: effectiveTabId,
				message,
				messages: req.messages,
				attachments,
				model,
				temperature: req.temperature,
				maxTokens: req.maxTokens
			})) {
				if (chunk.type === 'token' && chunk.token) {
					fullResponse += chunk.token;
					yield { type: 'token', data: { token: chunk.token, tabId: effectiveTabId, conversationId: effectiveTabId } };
				} else if (chunk.type === 'usage' && typeof chunk.totalTokens === 'number') {
					totalTokens = chunk.totalTokens;
					yield { type: 'usage', data: { totalTokens, tabId: effectiveTabId, conversationId: effectiveTabId, model: chunk.model || model } };
				} else if (chunk.type === 'tool_step') {
					yield { type: 'tool_step', data: chunk.toolStep };
				}
			}
		} catch (err: any) {
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
			fullResponse = fullResponse ? `${fullResponse}\n\n> ${errorNotice}` : `> ${errorNotice}`;

			yield { type: 'token', data: { token: fullResponse, tabId: effectiveTabId, conversationId: effectiveTabId } };
			yield { type: 'error', data: { error: cleanError, tabId: effectiveTabId, conversationId: effectiveTabId } };
		}

		// 3. Save assistant message and update tab
		const assistantMsg = repos.addMessage(
			effectiveTabId,
			'assistant',
			fullResponse,
			undefined,
			model,
			totalTokens ? { totalTokens } : undefined
		);

		// Update tab's last response snippet
		repos.updateTabLastResponse(effectiveTabId, fullResponse.slice(0, 200), model);

		yield {
			type: 'complete',
			data: {
				tabId: effectiveTabId,
				conversationId: effectiveTabId,
				messageId: assistantMsg.id,
				totalTokens,
				model
			}
		};
	}
}

export const llmRouter = new LlmRouter();

