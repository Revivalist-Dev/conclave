import { describe, expect, test } from 'bun:test';
import { DEFAULT_PROVIDER_ENDPOINT, resolveEndpoint } from '../src/providers/endpoint';

describe('resolveEndpoint', () => {
	test('strips a single trailing slash', () => {
		expect(resolveEndpoint('http://127.0.0.1:9000/v1/')).toBe('http://127.0.0.1:9000/v1');
	});

	test('strips several trailing slashes', () => {
		expect(resolveEndpoint('http://127.0.0.1:9000/v1////')).toBe('http://127.0.0.1:9000/v1');
	});

	test('trims surrounding whitespace before stripping a trailing slash', () => {
		expect(resolveEndpoint('  http://127.0.0.1:9000/v1/  ')).toBe('http://127.0.0.1:9000/v1');
	});

	test('falls back to the default for null, undefined and empty', () => {
		expect(resolveEndpoint(null)).toBe(DEFAULT_PROVIDER_ENDPOINT);
		expect(resolveEndpoint(undefined)).toBe(DEFAULT_PROVIDER_ENDPOINT);
		expect(resolveEndpoint('')).toBe(DEFAULT_PROVIDER_ENDPOINT);
		expect(resolveEndpoint('   ')).toBe(DEFAULT_PROVIDER_ENDPOINT);
	});

	test('falls back to the default for a slash-only value', () => {
		expect(resolveEndpoint('/')).toBe(DEFAULT_PROVIDER_ENDPOINT);
		expect(resolveEndpoint('///')).toBe(DEFAULT_PROVIDER_ENDPOINT);
	});

	test('passes a real alternative endpoint through unchanged', () => {
		expect(resolveEndpoint('http://192.168.1.50:11434/v1')).toBe('http://192.168.1.50:11434/v1');
	});

	test('the declared default is the DanyAPI endpoint', () => {
		expect(DEFAULT_PROVIDER_ENDPOINT).toBe('http://127.0.0.1:8000/v1');
		expect(resolveEndpoint(DEFAULT_PROVIDER_ENDPOINT)).toBe(DEFAULT_PROVIDER_ENDPOINT);
	});
});
