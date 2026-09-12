import type { ProviderAdapter, ProviderChatOptions, ProviderStreamChunk } from './types';

export class LocalMockProvider implements ProviderAdapter {
	public readonly name = 'LocalMock';
	public readonly models = [
		{ id: 'mock-fast', name: 'Local Mock Fast', description: 'Local mock fallback' }
	];

	public async isAvailable(): Promise<boolean> {
		return true;
	}

	public async *streamChat(options: ProviderChatOptions): AsyncGenerator<ProviderStreamChunk> {
		const { message, model } = options;
		const mockTokens = [
			`I received your message regarding: "${message.slice(0, 60)}". `,
			'The orchestrator processed the request through the local pipeline. ',
			`Active model is configured to **${model || 'default'}**. `,
			'The SQLite database has persisted this turn and all execution logs are recorded.'
		];

		let generatedLength = 0;
		for (const token of mockTokens) {
			await new Promise((r) => setTimeout(r, 45));
			generatedLength += token.split(/\s+/).length;
			yield { type: 'token', token };
		}

		// Emit total tokens
		const promptTokens = Math.max(1, Math.round(message.length / 4));
		const completionTokens = generatedLength;
		const totalTokens = promptTokens + completionTokens;
		yield { type: 'usage', totalTokens };
	}
}

export const localMockProvider = new LocalMockProvider();
