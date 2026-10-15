#!/usr/bin/env node

/**
 * Conclave MCP Stdio Bridge
 *
 * Connects standard stdio-based MCP clients (Claude Desktop, Cursor, Zed, Windsurf)
 * to the running Conclave orchestrator over HTTP JSON-RPC (http://127.0.0.1:4000/mcp).
 *
 * Zero external dependencies — works out-of-the-box with Node.js or Bun.
 */

import readline from 'node:readline';

const ORCHESTRATOR_MCP_URL = process.env.CONCLAVE_MCP_URL || 'http://127.0.0.1:4000/mcp';

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

rl.on('line', async (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;

	let request;
	try {
		request = JSON.parse(trimmed);
	} catch (err) {
		const parseError = {
			jsonrpc: '2.0',
			id: null,
			error: { code: -32700, message: 'Parse error' }
		};
		process.stdout.write(JSON.stringify(parseError) + '\n');
		return;
	}

	const isNotification = request.id === undefined || request.id === null;

	try {
		const res = await fetch(ORCHESTRATOR_MCP_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Origin': 'http://127.0.0.1:4000'
			},
			body: JSON.stringify(request)
		});

		if (res.status === 204 || isNotification) {
			// JSON-RPC 2.0 notifications do not receive a response
			return;
		}

		if (!res.ok) {
			const errText = await res.text().catch(() => res.statusText);
			const errResponse = {
				jsonrpc: '2.0',
				id: request.id,
				error: { code: -32000, message: `Conclave HTTP ${res.status}: ${errText}` }
			};
			process.stdout.write(JSON.stringify(errResponse) + '\n');
			return;
		}

		const data = await res.json();
		process.stdout.write(JSON.stringify(data) + '\n');
	} catch (err) {
		if (isNotification) return;

		const errorResponse = {
			jsonrpc: '2.0',
			id: request.id,
			error: {
				code: -32000,
				message: `Cannot connect to Conclave orchestrator at ${ORCHESTRATOR_MCP_URL}. Please ensure Conclave is running.`
			}
		};
		process.stdout.write(JSON.stringify(errorResponse) + '\n');
	}
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
