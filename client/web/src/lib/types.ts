export interface ToolStepDetail {
	title: string;
	content: string;
	language?: string;
	status?: 'success' | 'error' | 'info';
}

export interface ToolStep {
	id: string;
	name: string;
	count?: number;
	icon?: 'linear' | 'code' | 'git' | 'search' | 'terminal' | 'check' | 'folder' | 'tool';
	status: 'pending' | 'running' | 'completed' | 'failed';
	details?: ToolStepDetail[];
	durationMs?: number;
}

export interface Attachment {
	id?: string;
	name: string;
	size: number;
	filepath?: string;
	mimeType?: string;
	status?: 'uploading' | 'ready' | 'error';
	error?: string;
}

export interface Message {
	id: string;
	tabId?: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	attachments?: Attachment[];
	toolSteps?: ToolStep[];
	providerId?: string;
	model?: string;
	totalTokens?: number;
	usage?: any;
	/** Set when the server's `messages.error` column is 1 (provider failure), or by the client deadline on expiry. */
	error?: boolean;
	createdAt: number;
}

export interface Project {
	id: string; // 3x base-58
	name: string;
	icon?: string;
	directory_path?: string;
	skills?: string[];
	metadata?: any;
	created_at?: number;
	updated_at?: number;
}

export interface Tab {
	id: string; // 4x base-58 sequence, doubles as LLM session_id
	project_id: string;
	name: string;
	last_response?: string;
	last_model?: string;
	messages: Message[];
	created_at?: number;
	updated_at?: number;
	starred?: boolean;
}

// Conversation is an alias for Tab with backwards-compatible properties
export interface Conversation {
	id: string;
	chatId: string;
	title: string;
	group: string;
	project_id?: string;
	projectDirectory?: string;
	providerId: string;
	model: string;
	messages: Message[];
	createdAt: number;
	updatedAt: number;
	starred?: boolean;
	archived?: boolean;
}

export interface Provider {
	id: string;
	name: string;
	type: 'ollama' | 'lmstudio' | 'vllm' | 'custom' | 'claude' | 'openai' | 'deepseek';
	endpoint: string;
	models: string[];
	activeModel: string;
	status: 'online' | 'offline' | 'checking';
	latency?: number;
	isLocal?: boolean;
}

export interface HarnessSettings {
	temperature: number;
	maxTokens: number;
	topP: number;
	systemPrompt: string;
	stream: boolean;
	routerEndpoint: string;
	overlayResponseDuration?: number;
}

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	desc?: string;
}
