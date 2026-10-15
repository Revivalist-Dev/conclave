import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { repos } from '../db';
import { supervisor } from '../processes/supervisor';
import { pluginManager } from '../plugins';

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
		this.rootDir = process.env.CONCLAVE_PROJECT_ROOT || process.cwd();
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

	public async handleJsonRpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
		const { id, method, params } = req;
		const isNotification = id === undefined || id === null;

		// JSON-RPC 2.0 notifications: server MUST NOT send a reply
		switch (method) {
			case 'notifications/initialized':
			case 'notifications/cancelled': {
				return null;
			}

			case 'initialize': {
				const requestedVersion = params?.protocolVersion || '2024-11-05';
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: requestedVersion,
						serverInfo: {
							name: 'conclave-orchestrator',
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
				if (isNotification) return null;
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: [...this.tools.values(), ...pluginManager.listMcpTools()]
					}
				};
			}

			case 'tools/call': {
				if (isNotification) return null;
				const toolName = params?.name;
				if (typeof toolName !== 'string' || !toolName.trim()) {
					return {
						jsonrpc: '2.0',
						id,
						error: { code: -32602, message: 'Invalid params: "name" must be a non-empty string' }
					};
				}
				const args = params?.arguments || {};
				let effectiveToolName = toolName;
				if (!toolName.startsWith('plugin_') && !this.tools.has(toolName)) {
					const pluginTools = pluginManager.listMcpTools();
					const match = pluginTools.find((t) => t.name === `plugin_danyapi_${toolName}` || t.name.endsWith(`_${toolName}`));
					if (match) {
						effectiveToolName = match.name;
					}
				}

				if (effectiveToolName.startsWith('plugin_')) {
					try {
						const result = (await pluginManager.callTool(effectiveToolName, args)) as any;
						if (result && typeof result === 'object') {
							result.tool_name = result.tool_name || effectiveToolName;
						}
						return { jsonrpc: '2.0', id, result };
					} catch (err: any) {
						return {
							jsonrpc: '2.0',
							id,
							result: {
								tool_name: effectiveToolName,
								content: [{ type: 'text', text: `Plugin tool failed: ${err.message}` }],
								isError: true
							}
						};
					}
				}
				return this.executeTool(id, effectiveToolName, args);
			}

			case 'resources/list': {
				if (isNotification) return null;
				return {
					jsonrpc: '2.0',
					id,
					result: {
						resources: [
							{
								uri: 'conclave://db/stats',
								name: 'Database Statistics',
								mimeType: 'application/json'
							},
							{
								uri: 'conclave://services/status',
								name: 'Managed Services Health',
								mimeType: 'application/json'
							}
						]
					}
				};
			}

			case 'resources/read': {
				if (isNotification) return null;
				const uri = params?.uri;
				if (uri === 'conclave://db/stats') {
					const tabs = repos.getAllTabs();
					return {
						jsonrpc: '2.0',
						id,
						result: {
							contents: [
								{
									uri,
									mimeType: 'application/json',
									text: JSON.stringify({ totalConversations: tabs.length }, null, 2)
								}
							]
						}
					};
				}
				if (uri === 'conclave://services/status') {
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
				if (isNotification) return null;
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
				if (typeof cmd !== 'string' || !cmd.trim()) {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: 'Error: "command" parameter is required' }], isError: true }
					};
				}
				let cwd = this.rootDir;
				if (args.cwd && typeof args.cwd === 'string') {
					const resolvedCwd = resolve(this.rootDir, args.cwd);
					if (resolvedCwd.startsWith(this.rootDir)) {
						cwd = resolvedCwd;
					}
				}
				const res = spawnSync('sh', ['-c', cmd], {
					cwd,
					encoding: 'utf-8',
					timeout: 30000,
					maxBuffer: 10 * 1024 * 1024
				});
				const stdout = (res.stdout || '').trim();
				const stderr = (res.stderr || '').trim();
				let text = '';
				if (res.status !== 0) {
					text = stderr ? (stdout ? `${stdout}\n\n[stderr]:\n${stderr}` : stderr) : (stdout || `Command failed with code ${res.status}`);
				} else {
					text = stdout ? (stderr ? `${stdout}\n\n[stderr]:\n${stderr}` : stdout) : (stderr || '(command completed with no output)');
				}
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tool_name: name,
						content: [{ type: 'text', text }],
						isError: res.status !== 0
					}
				};
			}

			if (name === 'read_file') {
				if (!args.path || typeof args.path !== 'string') {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: 'Error: "path" parameter is required' }], isError: true }
					};
				}
				const filePath = resolve(this.rootDir, args.path);
				if (!filePath.startsWith(this.rootDir)) {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: `Access denied: path '${args.path}' is outside project root` }], isError: true }
					};
				}
				if (!existsSync(filePath)) {
					return {
						jsonrpc: '2.0',
						id,
						result: {
							tool_name: name,
							content: [{ type: 'text', text: `File not found: ${args.path}` }],
							isError: true
						}
					};
				}
				const content = readFileSync(filePath, 'utf-8');
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tool_name: name,
						content: [{ type: 'text', text: content }]
					}
				};
			}

			if (name === 'write_file') {
				if (!args.path || typeof args.path !== 'string') {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: 'Error: "path" parameter is required' }], isError: true }
					};
				}
				const filePath = resolve(this.rootDir, args.path);
				if (!filePath.startsWith(this.rootDir)) {
					return {
						jsonrpc: '2.0',
						id,
						result: { tool_name: name, content: [{ type: 'text', text: `Access denied: path '${args.path}' is outside project root` }], isError: true }
					};
				}
				writeFileSync(filePath, args.content || '', 'utf-8');
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tool_name: name,
						content: [{ type: 'text', text: `Successfully wrote ${(args.content || '').length} bytes to ${args.path}` }]
					}
				};
			}

			if (name === 'get_service_status') {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tool_name: name,
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
					tool_name: name,
					content: [{ type: 'text', text: `Execution failed: ${err.message}` }],
					isError: true
				}
			};
		}
	}
}

export const mcpServer = new LightweightMcpServer();
