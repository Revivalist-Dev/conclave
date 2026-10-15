import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { composeContract, composeContractError } from '../src/bootstrap/compose';
import { imageIdFromComposeImages, parseComposeJson } from '../src/processes/compose';

// The vendored recipe is read from disk, not restated here: a test that repeats
// the digest would keep passing after the file it is meant to guard lost it.
const RECIPE_DIR = join(import.meta.dir, '..', 'provider-build');
const readRecipe = (name: string) => readFileSync(join(RECIPE_DIR, name), 'utf-8');

const DIRECT_REQUIREMENTS = [
	'fastapi',
	'uvicorn',
	'httpx',
	'pydantic',
	'python-dotenv',
	'pillow',
	'python-multipart',
	'socksio'
];

describe('composeContract', () => {
	test('reads the service name and published host port out of the vendored file', () => {
		expect(composeContract(readRecipe('docker-compose.yml'))).toEqual({ service: 'danyapi', hostPort: 8000 });
	});

	test('the vendored file satisfies the contract the supervisor probes', () => {
		expect(composeContractError(readRecipe('docker-compose.yml'))).toBe(null);
	});

	test('a renamed service is refused by name', () => {
		const error = composeContractError('services:\n  api:\n    build: .\n    ports:\n      - "8000:8000"\n');

		expect(error).toContain('api');
		expect(error).toContain('danyapi');
	});

	test('a drifted host port is refused by number', () => {
		const error = composeContractError('services:\n  danyapi:\n    build: .\n    ports:\n      - "9000:8000"\n');

		expect(error).toContain('9000');
		expect(error).toContain('8000');
	});

	test('a file with no services block names what is missing rather than passing', () => {
		const error = composeContractError('version: "3"\n');

		expect(error).toContain('(none)');
	});
});

describe('parseComposeJson', () => {
	test('accepts the one-array shape modern Compose prints', () => {
		expect(parseComposeJson('[{"State":"running"}]')).toEqual([{ State: 'running' }]);
	});

	test('accepts the one-object-per-line shape older Compose prints', () => {
		expect(parseComposeJson('{"State":"running"}\n{"State":"exited"}\n')).toEqual([
			{ State: 'running' },
			{ State: 'exited' }
		]);
	});

	test('empty output is an empty list, not a parse error', () => {
		expect(parseComposeJson('')).toEqual([]);
		expect(parseComposeJson('   \n')).toEqual([]);
	});
});

describe('imageIdFromComposeImages', () => {
	test('takes the image id out of the shape Compose 5.6.0 emits', () => {
		// Captured verbatim from `docker compose images --format json` on
		// 2026-10-15 against a real build of the vendored recipe.
		const stdout =
			'[{"ID":"sha256:38af04f23e2f2abe2f85ac1fe6911fa2d4f2e966e5c5b535dcd44d322c6cb259","ContainerName":"danyapi","Repository":"s1probe-danyapi","Tag":"latest","Platform":"linux/amd64"}]';

		expect(imageIdFromComposeImages(stdout)).toBe(
			'sha256:38af04f23e2f2abe2f85ac1fe6911fa2d4f2e966e5c5b535dcd44d322c6cb259'
		);
	});

	test('the ImageId alias is accepted too, since the key has moved between versions', () => {
		expect(imageIdFromComposeImages('[{"ImageId":"sha256:def456"}]')).toBe('sha256:def456');
	});

	test('no entries and no usable id both answer null rather than inventing one', () => {
		expect(imageIdFromComposeImages('')).toBe(null);
		expect(imageIdFromComposeImages('[{"Repository":"danyapi-danyapi"}]')).toBe(null);
	});
});

describe('vendored Dockerfile', () => {
	// Read from provider-build/ on 2026-10-15 with
	// `docker buildx imagetools inspect python:3.14-slim`, whose `Digest:` line is
	// the manifest-list digest below.
	const BASE_PIN = 'sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170';

	test('pins the base image by manifest-list digest rather than a moving tag', () => {
		const dockerfile = readRecipe('Dockerfile');
		const fromLines = dockerfile.split(/\r?\n/).filter((line) => line.startsWith('FROM '));

		expect(fromLines).toHaveLength(1);
		expect(fromLines[0]).toBe(`FROM python:3.14-slim@${BASE_PIN}`);
	});

	test('resolves packages through the constraints file rather than bare names', () => {
		expect(readRecipe('Dockerfile')).toContain('-r requirements.txt -c constraints.txt');
	});
});

describe('vendored constraints', () => {
	const constraints = readRecipe('constraints.txt');
	const requirementLines = constraints
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));

	test('every entry is an exact pin, so a later pip cannot take a newer package', () => {
		for (const line of requirementLines) {
			expect(line).toMatch(/^[A-Za-z0-9._-]+(?:\[[A-Za-z0-9._,-]+\])?==[^\s;]+$/);
		}
	});

	test('the checkout names seven packages, and each of them is constrained', () => {
		for (const name of DIRECT_REQUIREMENTS) {
			const match = requirementLines.find((line) => line.startsWith(`${name}==`));
			expect(match).toBeTruthy();
		}
	});
});
