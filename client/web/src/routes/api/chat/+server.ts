import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

/**
 * Bun Router Chat Endpoint
 *
 * This server route accepts incoming chat requests from the harness UI
 * and delegates them to local LLMs or an external Bun router service.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { conversationId, providerId, model, messages, settings } = body;

	// Check if an external Bun router endpoint is specified (e.g. BUN_ROUTER_URL or custom setting)
	const customEndpoint =
		env.BUN_ROUTER_URL ||
		(settings?.routerEndpoint && settings.routerEndpoint !== '/api/chat'
			? settings.routerEndpoint
			: null);

	if (customEndpoint) {
		try {
			const upstream = await fetch(customEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (upstream.ok && upstream.body) {
				return new Response(upstream.body, {
					headers: {
						'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
						'Cache-Control': 'no-cache',
						'Connection': 'keep-alive'
					}
				});
			}
		} catch (err: any) {
			console.warn(`[Bun Router] Target at ${customEndpoint} unreachable, falling back:`, err.message);
		}
	}

	// Local Bun router delegation handler
	const userMessage = messages[messages.length - 1]?.content || '';

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const sendData = (data: any) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

			// Analyze user intent for tool steps
			const lower = userMessage.toLowerCase();

			if (lower.includes('linear') || lower.includes('bug') || lower.includes('issue')) {
				// Tool step: Linear lookup
				const stepId = 'step-' + Date.now();
				sendData({
					toolStep: {
						id: stepId,
						name: 'Checked new bugs in Linear',
						count: 3,
						icon: 'linear',
						status: 'running',
						details: [{ title: 'Connecting to Linear API', content: 'Syncing project issues...', status: 'info' }]
					}
				});
				await sleep(600);

				sendData({
					toolStep: {
						id: stepId,
						status: 'completed',
						details: [
							{ title: 'Linear query', content: 'Found 3 open bugs: WEB-476, WEB-475, WEB-474', status: 'success' },
							{ title: 'WEB-476 details', content: 'Mobile navigation stays open after selecting a link', status: 'success' }
						]
					}
				});
				await sleep(400);

				const reply = `I verified the reports in Linear. **WEB-476: Mobile navigation stays open after selecting a link** is the top priority bug reported today. On mobile viewports, tapping any navigation link loads the destination page but fails to close the drawer overlay, keeping page scroll locked.`;
				for (const word of reply.split(' ')) {
					sendData({ content: word + ' ' });
					await sleep(25);
				}
			} else if (lower.includes('fix') || lower.includes('edit') || lower.includes('code')) {
				// Tool step: Edit files
				const stepId = 'step-' + Date.now();
				sendData({
					toolStep: {
						id: stepId,
						name: 'Edited 2 files and verified the fix',
						count: 4,
						icon: 'code',
						status: 'running',
						details: [{ title: 'Locating navigation components', content: 'Analyzing src/lib/components/MobileNav.svelte...', status: 'info' }]
					}
				});
				await sleep(700);

				sendData({
					toolStep: {
						id: stepId,
						status: 'completed',
						details: [
							{
								title: 'src/lib/components/MobileNav.svelte',
								content: '- onClick={() => navigate(item.href)}\n+ onClick={() => { closeMenu(); unlockScroll(); navigate(item.href); }}',
								language: 'diff',
								status: 'success'
							},
							{
								title: 'tests/navigation.test.ts',
								content: 'PASS tests/navigation.test.ts (2 tests, 12 assertions passed in 14ms)',
								status: 'success'
							}
						]
					}
				});
				await sleep(300);

				const reply = `Applied the fix to close the mobile menu on link navigation and restore document scroll. All regression and integration tests passed cleanly.`;
				for (const word of reply.split(' ')) {
					sendData({ content: word + ' ' });
					await sleep(25);
				}
			} else if (lower.includes('pr') || lower.includes('pull request') || lower.includes('git')) {
				// Tool step: Git & PR
				const stepId = 'step-' + Date.now();
				sendData({
					toolStep: {
						id: stepId,
						name: 'Pushed the fix and created a PR',
						count: 3,
						icon: 'git',
						status: 'running',
						details: [{ title: 'git push', content: 'Pushing branch to origin...', status: 'info' }]
					}
				});
				await sleep(600);

				sendData({
					toolStep: {
						id: stepId,
						status: 'completed',
						details: [
							{ title: 'git commit', content: 'commit 4a9f12: fix(nav): auto-close mobile drawer on link click', status: 'success' },
							{ title: 'GitHub PR', content: 'Created PR #494: "fix(nav): close mobile drawer on link click"', status: 'success' }
						]
					}
				});
				await sleep(300);

				const reply = `Created **PR #494**. CI workflows have been dispatched and the review request has been assigned.`;
				for (const word of reply.split(' ')) {
					sendData({ content: word + ' ' });
					await sleep(25);
				}
			} else {
				// General response
				const reply = `[Routed via Bun (${providerId} / ${model})] Received your query: "${userMessage}". Local LLM engines can latch into this router to return structured output, tool calls, or streaming markdown.`;
				for (const word of reply.split(' ')) {
					sendData({ content: word + ' ' });
					await sleep(20);
				}
			}

			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};
