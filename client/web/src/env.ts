import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Environment variables exposed through `$app/env/private`.
 *
 * SvelteKit 3 replaced the implicit `env` record of `$env/dynamic/private`
 * with an explicit declarative list, so every variable read by a server
 * module has to be named here.
 */
export const variables = defineEnvVars({
	BUN_ROUTER_URL: {
		description:
			'Optional external Bun router endpoint that /api/chat proxies to. Unset falls back to the built-in streaming handler.',
		schema: (value: string | undefined) => value
	}
});
