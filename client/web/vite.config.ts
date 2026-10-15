import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			// SvelteKit 3 removed the built-in `$lib` alias; re-declare it so existing
			// `$lib/...` imports keep resolving (kit 3 prefers `#lib` subpath imports).
			alias: { $lib: 'src/lib' },
			adapter: adapter({
				fallback: 'index.html',
				pages: 'build',
				assets: 'build',
				precompress: false,
				strict: false
			})
		})
	],
	server: {
		host: true,
		port: 5173,
		allowedHosts: true
	}
});
