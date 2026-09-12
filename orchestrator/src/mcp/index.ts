import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { repos } from '../db';
import { supervisor } from '../processes/supervisor';

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, any>;
}

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: any;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number;
	result?: any;
	error?: {
		code: number;
		message: string;
		data?: any;
	};
}

export class LightweightMcpServer {
	private tools: Map<string, McpTool> = new Map();
	private rootDir: string;

	constructor() {
		this.rootDir = join(import.meta.dir, '../../../');
		this.registerBuiltinTools();
	}

	private registerBuiltinTools() {
		this.tools.set('run_command', {
			name: 'run_command',
			description: 'Run a shell command on the host environment',
			inputSchema: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'Command to execute' },
					cwd: { type: 'string', description: 'Working directory' }
				},
				required: ['command']
			}
		});

		this.tools.set('read_file', {
			name: 'read_file',
			description: 'Read the contents of a local file',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Absolute or relative file path' }
				},
				required: ['path']
			}
		});

		this.tools.set('write_file', {
			name: 'write_file',
			description: 'Write content to a local file',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'File path' },
					content: { type: 'string', description: 'File content' }
				},
				required: ['path', 'content']
			}
		});

		this.tools.set('get_service_status', {
			name: 'get_service_status',
			description: 'Retrieve running status and ports of orchestrator services (DanyAPI, SQLite)',
			inputSchema: {
				type: 'object',
				properties: {}
			}
		});
	}

	public handleJsonRpc(req: JsonRpcRequest): JsonRpcResponse {
		const { id, method, params } = req;

		switch (method) {
			case 'initialize': {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						serverInfo: {
							name: 'brAInstorm-orchestrator',
							version: '0.1.0'
						},
						capabilities: {
							tools: {},
							resources: {},
							prompts: {}
						}
					}
				};
			}

			case 'tools/list': {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: Array.from(this.tools.values())
					}
				};
			}

			case 'tools/call': {
				const toolName = params?.name;
				const args = params?.arguments || {};
				return this.executeTool(id, toolName, args);
			}

			case 'resources/list': {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						resources: [
							{
								uri: 'brainstorm://db/stats',
								name: 'Database Statistics',
								mimeType: 'application/json'
							},
							{
								uri: 'brainstorm://services/status',
								name: 'Managed Services Health',
								mimeType: 'application/json'
							}
						]
					}
				};
			}

			case 'resources/read': {
				const uri = params?.uri;
				if (uri === 'brainstorm://db/stats') {
					const convos = repos.getConversations();
					return {
						jsonrpc: '2.0',
						id,
						result: {
							contents: [
								{
									uri,
									mimeType: 'application/json',
									text: JSON.stringify({ totalConversations: convos.length }, null, 2)
								}
							]
						}
					};
				}
				if (uri === 'brainstorm://services/status') {
					return {
						jsonrpc: '2.0',
						id,
						result: {
							contents: [
								{
									uri,
									mimeType: 'application/json',
									text: JSON.stringify(supervisor.getStatus(), null, 2)
								}
							]
						}
					};
				}
				return {
					jsonrpc: '2.0',
					id,
					error: { code: -32602, message: `Unknown resource URI: ${uri}` }
				};
			}

			default:
				return {
					jsonrpc: '2.0',
					id,
					error: { code: -32601, message: `Method not found: ${method}` }
				};
		}
	}

	private executeTool(id: string | number, name: string, args: any): JsonRpcResponse {
		try {
			if (name === 'run_command') {
				const cmd = args.command;
				const cwd = args.cwd || this.rootDir;
				const res = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf-8', timeout: 30000 });
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [
							{
								type: 'text',
								text: res.stdout || res.stderr || '(command completed with no output)'
							}
						],
						isError: res.status !== 0
					}
				};
			}

			if (name === 'read_file') {
				const filePath = args.path.startsWith('/') ? args.path : join(this.rootDir, args.path);
				if (!existsSync(filePath)) {
					return {
						jsonrpc: '2.0',
						id,
						result: {
							content: [{ type: 'text', text: `File not found: ${filePath}` }],
							isError: true
						}
					};
				}
				const content = readFileSync(filePath, 'utf-8');
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [{ type: 'text', text: content }]
					}
				};
			}

			if (name === 'write_file') {
				const filePath = args.path.startsWith('/') ? args.path : join(this.rootDir, args.path);
				writeFileSync(filePath, args.content, 'utf-8');
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [{ type: 'text', text: `Successfully wrote ${args.content.length} bytes to ${filePath}` }]
					}
				};
			}

			if (name === 'get_service_status') {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						content: [
							{
								type: 'text',
								text: JSON.stringify(supervisor.getStatus(), null, 2)
							}
						]
					}
				};
			}

			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32601, message: `Unknown tool: ${name}` }
			};
		} catch (err: any) {
			return {
				jsonrpc: '2.0',
				id,
				result: {
					content: [{ type: 'text', text: `Execution failed: ${err.message}` }],
					isError: true
				}
			};
		}
	}
}

export const mcpServer = new LightweightMcpServer();
