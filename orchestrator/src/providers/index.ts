import type { ModelDescriptor, ProviderAdapter } from './types';
import { danyApiProvider } from './danyapi';
import { localMockProvider } from './mock';

export * from './types';
export { danyApiProvider } from './danyapi';
export { localMockProvider } from './mock';

export function getAllAvailableModels(): (ModelDescriptor & { provider: string })[] {
	return [
		...danyApiProvider.models.map((m) => ({
			...m,
			provider: m.id.includes('qwen') ? 'Qwen' : 'DeepSeek'
		}))
	];
}

export function getProvider(name?: string): ProviderAdapter {
	const prov = (name || '').toLowerCase();
	if (prov.includes('deepseek') || prov.includes('dany') || prov.includes('qwen') || prov === 'default' || !prov) {
		return danyApiProvider;
	}
	// Future adapters (Gemini, Claude, Ollama, LM Studio) can be routed here
	return danyApiProvider;
}
