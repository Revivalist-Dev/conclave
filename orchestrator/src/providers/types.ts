export interface ProviderStreamChunk {
	type: 'token' | 'usage' | 'tool_step';
	token?: string;
	totalTokens?: number;
	usage?: any;
	toolStep?: any;
}

export interface AttachmentMeta {
	name: string;
	filepath?: string;
	mimeType?: string;
	size?: number;
}

export interface ProviderChatOptions {
	conversationId: string;
	chatId: string;
	sessionId: string;
	message: string;
	messages?: Array<{ role: string; content: string }>;
	attachments?: AttachmentMeta[];
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface ModelDescriptor {
	id: string;
	name: string;
	description?: string;
}

export interface ProviderAdapter {
	readonly name: string;
	readonly models: ModelDescriptor[];
	streamChat(options: ProviderChatOptions): AsyncGenerator<ProviderStreamChunk>;
	uploadFile?(
		fileBuffer: Buffer | ArrayBuffer,
		filename: string,
		sessionId: string,
		mimeType?: string,
		model?: string
	): Promise<any>;
	isAvailable(): Promise<boolean>;
}
