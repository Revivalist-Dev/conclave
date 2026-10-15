---
title: DanyAPI review — the local LLM backend and how Conclave couples to it
topic: danyapi-review
updated: 2026-10-15
status: current
---

# DanyAPI review — the local LLM backend and how Conclave couples to it

**DanyAPI** is the one external service this tree is built around: an OpenAI-compatible FastAPI server that
runs in Docker on `127.0.0.1:8000` and supplies every model the Conclave UI offers. This page reads it from
both ends — what the snapshot on this machine actually serves, and what the orchestrator actually calls —
and reports the places where the two ends do not agree.

Every claim below was read out of a file on **2026-10-15**, from three sources named inline:

| Source | Path | What it is |
|---|---|---|
| the **snapshot** | [`../../../../.agent-resources/DanyAPI-prod/`](../../../../.agent-resources/DanyAPI-prod/) | the upstream source tree on this machine — 86 test files, three CI workflows, `danyapi/api/` split into 19 modules |
| the **fork** | `mindflowgo/DanyAPI` @ `e551331` on GitHub | the repository the image and the clone both come from — `danyapi/api/` holds **only `openai.py`**, a 2800-line monolith |
| **conclave** | this tree | the consumer |

Registry and GitHub facts were read live the same day; the queries are recorded in §8.

## 1. What DanyAPI is — and what it is not

It is a **facade over consumer web clients**, not a model server. The snapshot's own README says it in the
first sentence:

> OpenAI compatible HTTP API built on Python + FastAPI. Instead of the paid APIs it talks to the internal
> APIs of the free web clients, and to the free tier of GigaChat.
> — [`README.md:3`](../../../../.agent-resources/DanyAPI-prod/README.md)

The fork's README is the older, narrower version of the same claim — it named only DeepSeek and Qwen:

> Instead of the paid APIs it talks to the internal APIs of the free web clients
> [chat.deepseek.com](https://chat.deepseek.com) and [chat.qwen.ai](https://chat.qwen.ai) using
> server-side accounts created from your own free provider tokens (`DEEPSEEK_TOKENS` / `QWEN_TOKENS`).
> API consumers need no keys - all upstream requests are made by the configured server tokens.
> — `mindflowgo/DanyAPI`, `README.md`

So the definition is **verified, and the fork is a strict subset of it**. What it is *not*, stated because
the tree's own labels imply otherwise:

- **Not a local inference engine.** Nothing in either tree loads weights. Every token is produced by a
  third party's consumer endpoint — DeepSeek's web client, Qwen's account API, GigaChat's official API, or
  one of the unofficial bridges (Alice over `wss://uniproxy.alice.yandex.net`, Duck.ai, Mistral Le Chat,
  Google AI Studio via a Camoufox browser). The snapshot's README documents each provider's upstream and
  each one's divergence from the OpenAI schema.
- **Not offline.** `README.md` documents `OPENCODE_KEYS`, `MISTRAL_LOGINS`, `AISTUDIO_LOGINS` and a
  DuckDuckGo-backed `web_search` tool; every one of those is an outbound internet dependency.
- **Not a model catalogue the caller can trust.** `GET /v1/models` is assembled at runtime from eight
  different upstreams, refetched every `DANYAPI_MODELS_REFRESH_SECONDS` (default 900), and a failed fetch
  *keeps the last good list* rather than emptying it — so a stale list is indistinguishable from a current
  one.
- **Not a service that executes no tools.** `MCP_SERVERS` + `"mcp": true` make the server run the tool-call
  loop host-side. Its own README flags the exposure: "Keep that in mind before enabling `MCP_SERVERS` on a
  server exposed to callers you do not trust."
- **Not a stable API for two providers.** The README's own wording for Alice and Duck.ai is "accepts no
  guarantee": "Yandex also versions and reshapes this protocol without notice, so the provider can break at
  any time." For Duck.ai it goes further and reports the measured failure: after a few dozen automated
  requests DuckDuckGo returns `ERR_BN_LIMIT` in ~0.1 s and stays that way.

What it *is* good at is worth stating too, because that is why it is here: it is a single container that
turns six-plus free provider accounts into one OpenAI-shaped endpoint with per-token usage accounting, SSE
streaming, server-side session caching, and multimodal staging. Nothing else in the tree supplies that.

## 2. The snapshot's complete route surface

**23 served endpoints: 22 `@app` route decorators plus one static mount.** They live in five modules, not in
one file. Complete list, with the decorator's own line:

| Method | Path | file:line |
|---|---|---|
| POST | `/v1/chat/completions` | [`danyapi/api/chats.py:85`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/chats.py) |
| POST | `/v1/completions` | [`chats.py:308`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/chats.py) |
| POST | `/v1/embeddings` | [`chats.py:359`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/chats.py) |
| POST | `/v1/moderations` | [`chats.py:365`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/chats.py) |
| POST | `/v1/tokens` | [`envtokens.py:566`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/envtokens.py) — requires `DANYAPI_ADMIN_TOKEN` or is disabled |
| POST | `/v1/images/generations` | [`images.py:146`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/images.py) |
| POST | `/v1/images/edits` | [`images.py:298`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/images.py) |
| POST | `/v1/images/variations` | [`images.py:329`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/images.py) |
| GET | `/v1/models` | [`models.py:472`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/models.py) |
| GET | `/v1/models/{model_id}` | [`models.py:480`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/models.py) |
| POST | `/v1/responses` | [`openai.py:543`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/v1/responses/{response_id}` | [`openai.py:843`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| DELETE | `/v1/responses/{response_id}` | [`openai.py:852`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/v1/responses/{response_id}/input_items` | [`openai.py:859`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| POST | `/v1/responses/{response_id}/cancel` | [`openai.py:892`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| POST | `/v1/messages` | [`openai.py:713`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) — Anthropic shape |
| POST | `/v1/messages/count_tokens` | [`openai.py:780`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/v1/providers` | [`openai.py:451`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/v1/usage` | [`openai.py:463`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/health` | [`openai.py:442`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/` | [`openai.py:357`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) — dashboard HTML |
| GET | `/favicon.ico` | [`openai.py:365`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/openai.py) |
| GET | `/docs/` | static mount, [`core.py:1151`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/core.py) |

Two endpoints are served but not advertised: `/favicon.ico` and `/v1/providers` are absent from the
README's endpoint list. Everything else in the list is present.

**There is no `POST /v1/files` and no `/v1/sessions` family anywhere in the snapshot** — confirmed by
`rg '@app\.(get|post|put|delete|patch)\('` over the whole tree, which returns the 22 lines above and
nothing else. The snapshot carries attachments as a **field on the chat request** instead:

- [`danyapi/api/schemas.py:65`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/schemas.py) —
  `files: list[FileSpec] | None = None` on `ChatCompletionRequest`;
- [`schemas.py:47-50`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/schemas.py) — `FileSpec` is
  `name` + `content` + `content_type`, so the payload is a base64 data URI;
- [`danyapi/api/attachments.py:18-20`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/attachments.py)
  — `MAX_FILES_PER_REQUEST = 50`, `MAX_ATTACHMENT_TOTAL_SIZE = 10 * 1024 * 1024`;
- the same module enforces both caps in three places (`:93`, `:117`, `:141`).

## 3. What Conclave actually calls

Four endpoints, three of them real.

| What Conclave calls | Where | Does the route exist? |
|---|---|---|
| `GET /v1/models` | [`danyapi.ts:20`](../../orchestrator/src/providers/danyapi.ts) (`isAvailable`), [`supervisor.ts:225`](../../orchestrator/src/processes/supervisor.ts) (`pingService`) | yes — `models.py:472` |
| `POST /v1/chat/completions` | [`danyapi.ts:94`](../../orchestrator/src/providers/danyapi.ts), [`plugins/danyapi/mcp.js`](../../orchestrator/plugins/danyapi/mcp.js) and the seeded copy in [`builtin.ts`](../../orchestrator/src/plugins/builtin.ts) | yes — `chats.py:85` |
| `POST /v1/files` | [`danyapi.ts:45`](../../orchestrator/src/providers/danyapi.ts) (`uploadFile`), [`index.ts:293`](../../orchestrator/src/index.ts) and the 404 retry at [`index.ts:302`](../../orchestrator/src/index.ts) | **not in the snapshot**; yes in the fork (`openai.py:1157`) |
| `DELETE /v1/session/<tabId>` | [`index.ts:54`](../../orchestrator/src/index.ts), called from [`index.ts:211`](../../orchestrator/src/index.ts) and [`index.ts:461`](../../orchestrator/src/index.ts) | **no — wrong path**; see §4.4 |

The request body the provider builds is real OpenAI-plus-extras and matches what the fork accepts:
`session_id` bound to the tab id, `stream: true`, and
[`stream_options: { include_usage: true }` at `danyapi.ts:86`](../../orchestrator/src/providers/danyapi.ts).
That last one is not decoration — the fork implements it at `openai.py:1529` (`_include_usage`) and emits a
usage chunk from `:2045` and `:2781`, which is what `danyapi.ts:148-157` reads back. Confirmed: the usage
path works, but only against the fork.

## 4. Where the two ends disagree

### 4.1 `/v1/files` — **confirmed**, and the mismatch is a version skew, not a typo

The brief's finding holds exactly.

- The snapshot has no such route (§2).
- The fork has it at `danyapi/api/openai.py:1157`, plus `GET /v1/files/{file_id}` at `:1292`, and a
  `/v1/sessions` family at `:1331`, `:1386` and `DELETE :1446`.
- The fork is a **fork**, not a different project: `gh api repos/mindflowgo/DanyAPI` resolves
  `parent: FANATFANATA/DanyAPI`, `source: FANATFANATA/DanyAPI`.

So Conclave's `/v1/files` + `session_id` coupling is **consistent with the fork, and inconsistent with the
snapshot and with today's upstream**. Point Conclave at a current upstream image and
`DanyApiProvider.uploadFile()` gets a 404 and the attachment has to be re-expressed as a `files[]` entry on
the completions request — `FileSpec` with a base64 `content`, capped at 50 files / 10 MB total.
`ARCHITECTURE.md:368` already anticipates the shape of that coupling without noticing it needs to change:
it notes the model name is lowercased before being sent to "completions and file staging endpoints
(`POST /v1/files`)".

### 4.2 `FANATFANATA/DanyAPI` — **confirmed 404**, and it takes the self-updater with it

```
gh api repos/FANATFANATA/DanyAPI  →  gh: Not Found (HTTP 404)
```

The original is gone. `mindflowgo/DanyAPI` survives only because a fork is an independent repository.
Three code paths still point at the dead URL:

- [`docs/start.py:16`](../../../../.agent-resources/DanyAPI-prod/docs/start.py) —
  `REPO = "FANATFANATA/DanyAPI"`, then `API = f"https://api.github.com/repos/{REPO}/releases/latest"` at
  `:17` and a tag-zip download at `:201`. This is the launcher the README calls "what the desktop shortcut
  runs", and `DANYAPI_AUTO_UPDATE` defaults to **`1`**.
- [`docs/install.ps1:3`](../../../../.agent-resources/DanyAPI-prod/docs/install.ps1) and
  [`docs/install.sh:3`](../../../../.agent-resources/DanyAPI-prod/docs/install.sh) — both hardcode
  `https://github.com/FANATFANATA/DanyAPI`.

The Docker path is unaffected: the container's `CMD` is `python -m danyapi`
([`Dockerfile:43`](../../../../.agent-resources/DanyAPI-prod/Dockerfile)), which does not self-update. So
this is a defect in the *published installer and self-updater*, not in Conclave's runtime — but it means the
snapshot cannot be updated and cannot be re-installed from its own instructions.

### 4.3 The image tag — **refuted as stated**, and the real exposure is worse

The brief reads: "the image tag is unpinned (`ghcr.io/mindflowgo/danyapi:latest`) on a fork". The tag
string is real, but **nothing in the tree pulls it.** `rg 'ghcr'` across the whole repository excluding
`node_modules` and lockfiles returns **three hits, all in prose in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md)** — `:72`, `:122`, `:652` — and zero hits in any executable file.

What actually happens at runtime is different, and the difference matters:

1. [`bootstrap/index.ts:43-68`](../../orchestrator/src/bootstrap/index.ts) clones
   `https://github.com/mindflowgo/DanyAPI.git` with `--depth 1` into `api_sandbox/DanyAPI`, or `git pull`s
   it on the next run ([`:71-78`](../../orchestrator/src/bootstrap/index.ts)). The default branch is `main`.
2. [`supervisor.ts:139`](../../orchestrator/src/processes/supervisor.ts) runs
   `docker compose up -d` in that directory.
3. The compose file that arrives with the clone does **not** use the registry image. Its own text:

```
# you can build from source: docker compose up --build
build: .
# or comment above out, and load latest from repo.
# image: ghcr.io/mindflowgo/danyapi:latest
```

— `docker-compose.yml:3-6` in `mindflowgo/DanyAPI`.

So `docker compose up -d` **builds an image from the cloned source**, and Conclave's runtime supply chain
is three unpinned moving inputs stacked on each other:

| Input | Value | Pinned? |
|---|---|---|
| source tree | the fork's `main` HEAD (`e551331` as of 2026-09-07, and `git pull`ed on every dev boot) | no |
| base image | `FROM python:3.14-slim` — `mindflowgo/DanyAPI`, `Dockerfile:1` | **no — a moving tag** |
| Python packages | 7 bare names with no version at all: `fastapi`, `uvicorn`, `httpx[socks]`, `pydantic`, `python-dotenv`, `pillow`, `python-multipart` — `requirements.txt:1-7` in the fork | **no** |

`ghcr.io/mindflowgo/danyapi` *does* exist and *is* public — an OCI index, tags `latest`, `sha-f65b3b7`,
`sha-4aa38e0`, `sha-e551331` — so the documented path is at least a real artefact. It is simply not the
path the code takes. **Unpinning the tag would fix documentation, not the build.** The fix that changes
behaviour is pinning the clone (a tag or a commit SHA) and pinning the fork's `FROM` and `requirements.txt`
— or switching the compose file to the digest-pinned registry image on purpose.

### 4.4 The teardown URL is wrong, and the failure is logged as success

Separately from the brief's four findings, and worth fixing on its own:

```44:56:orchestrator/src/index.ts
function deleteProviderSessions(tabId: string): void {
	const endpoints: string[] = [];
	try {
		if (repos.isDeepSeekEnabled()) {
			const endpoint = String(repos.getSetting('deepseek_endpoint') || 'http://127.0.0.1:8000/v1').replace(/\/+$/, '');
			endpoints.push(endpoint);
		}
	} catch {}

	for (const endpoint of endpoints) {
		fetch(`${endpoint}/session/${encodeURIComponent(tabId)}`, {
			method: 'DELETE',
```

`endpoint` is `http://127.0.0.1:8000/v1`, so the request goes to `DELETE /v1/session/<tabId>`. The fork's
route is `DELETE /v1/sessions/{session_id}` — **plural**, `openai.py:1446`. The doc comment two lines above
the function says `/v1/session/<tabId>`, so the mistake is in the comment and the code together.

The consequence is quiet by construction: the promise resolves with a 404, the `.then` prints
`Provider session delete <id> @ ...: 404`, and the comment's promise that "failures are ignored" is kept
literally. The local thread is deleted and the provider-side session is not, so sessions accumulate in
DanyAPI's cache until `DANYAPI_SESSION_TTL_SECONDS` (default 3600) expires them. From `Tab DELETE` at
[`index.ts:211`](../../orchestrator/src/index.ts) or `TAB_DELETE` at
[`index.ts:461`](../../orchestrator/src/index.ts), the deletion has never worked against the fork.

### 4.5 The model ids — **refuted for the fork, and mis-stated as a two-id problem**

The brief reads: "two of the six model ids Conclave declares may differ from what DanyAPI serves". Measured
against the container that is actually built, **all six resolve.** Against the snapshot, **four differ.**

Conclave declares six ids in [`danyapi.ts:4-11`](../../orchestrator/src/providers/danyapi.ts), repeated
verbatim in [`plugin.json`](../../orchestrator/plugins/danyapi/plugin.json) and in
[`builtin.ts`](../../orchestrator/src/plugins/builtin.ts). The fork resolves every one of them, by two
rules:

- four DeepSeek ids — `MODEL_TYPE_BY_NAME` at `openai.py:41-44` covers `deepseek-v4-flash`,
  `deepseek-v4-pro` and `deepseek-v4-vision`, and the two `-thinking` ids resolve through
  `REASONING_SUFFIXES = ("-thinking",)` at `:47` via the strip-and-retry at `:955-960`. `GET /v1/models`
  enumerates the suffixed variants too, at `:1021` and `:1031`;
- two Qwen ids — `QWEN_DEFAULT_MODELS` at `openai.py:49-65` lists exactly `qwen3.8-max`, `qwen3.7-plus` and
  `qwen3.7-max`.

Against the **snapshot**, the four DeepSeek ids are all wrong. It renames the public id and reduces the
alias set to two strings:
[`models.py:52`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/models.py) —
`DEEPSEEK_LEGACY_ALIASES = frozenset({"deepseek-v4.1-flash", "default"})` and
[`models.py:54`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/models.py) —
`DEEPSEEK_PUBLIC_IDS = {"default": "deepseek-v4.1-flash"}`. Reasoning is a **flag**, not a name suffix:
`thinking: bool | None` and `reasoning_effort: str | None` sit on the same request model at
[`schemas.py:59-61`](../../../../.agent-resources/DanyAPI-prod/danyapi/api/schemas.py), and the default
model string everywhere is `deepseek-v4.1-flash` (`schemas.py:54`, `:89`, `:116`). So
`deepseek-v4-flash`, `deepseek-v4-flash-thinking`, `deepseek-v4-pro` and `deepseek-v4-pro-thinking` would
each be an unknown model upstream, and a `-thinking` variant has to become the base id plus
`thinking: true`.

There is a **second, internal** inconsistency the brief did not name, and it is the one that bites first:
the web UI declares **seven** DeepSeek-lineage ids, not six, and the extra one is not in the provider
adapter. `deepseek-v4-vision` appears in
`client/web/src/routes/api/providers/+server.ts` and in
[`harness.svelte.ts`](../../client/web/src/lib/stores/harness.svelte.ts) (`INITIAL_PROVIDERS`), in both
cases alongside a fabricated `status: 'online'` and `latency: 18`. It is a real fork model
(`openai.py:44`, `model_type: "vision"`) and a real snapshot-non-model. The two lists therefore disagree
with each other about how many models exist, before either is compared to a container.

Correction to the brief: **no id is "maybe" wrong — six are right against the built container and all four
DeepSeek ids are wrong against the current upstream. The number to act on is four, and the direction of the
fix depends on which of the two you decide to run.**

## 5. Dependency currency

### 5.1 The snapshot's Python packages — 9 declared, 2 floors behind, 0 ranges that need editing

Read from [`requirements.txt:1-10`](../../../../.agent-resources/DanyAPI-prod/requirements.txt) and compared
against the live PyPI JSON API on 2026-10-15.

| # | Declared | Line | Latest on PyPI | Floor gap | Does the range admit the latest? |
|---|---|---|---|---|---|
| 1 | `fastapi>=0.142.2` | 1 | 0.143.2 | **minor** | yes |
| 2 | `uvicorn>=0.54.0` | 2 | 0.54.0 | none | yes |
| 3 | `httpx>=0.28.1` | 3 | 0.28.1 | none | yes |
| 4 | `pydantic>=2.13.5` | 4 | 2.14.1 | **minor** | yes |
| 5 | `python-dotenv>=1.2.4` | 5 | 1.2.4 | none | yes |
| 6 | `pillow>=12.3.0` | 6 | 12.3.0 | none | yes |
| 7 | `python-multipart>=0.0.32` | 7 | 0.0.32 | none | yes |
| 8 | `websockets>=13.0` (py<3.11) / `>=17.2` (py≥3.11) | 8-9 | 17.2 | none on the ≥3.11 branch | yes — and `websockets` 17.2 itself declares `requires_python >=3.11`, so the marker split is load-bearing, not cosmetic |
| 9 | `certifi>=2026.7.22` | 10 | 2026.7.22 | none | yes |

**Dependency gaps: 2**, both `minor`, both floor-only, both requiring no manifest edit because live PyPI
already satisfies the declared range. Seven of nine floors are byte-identical to the current release, which
is a deliberately tight floor and worth keeping.

**The structural finding is not the two floors.** Every range is unbounded `>=` and there is **no
lockfile** — no `requirements.lock`, no `pip-compile` output, no hash pinning, no `constraints.txt`
anywhere in the snapshot. `pip install -r requirements.txt` therefore resolves to whatever is newest at
build time. The image is reproducible only because `FROM` is digest-pinned; the contents are not.

[`requirements-dev.txt`](../../../../.agent-resources/DanyAPI-prod/requirements-dev.txt) declares 18 more
packages **with no version at all** (`ruff`, `pytest`, `pytest-asyncio`, `pytest-cov`, `pytest-xdist`,
`hypothesis`, `mypy`, `pyright`, `pylint`, `flake8`, `pyflakes`, `isort`, `bandit`, `vulture`, `xenon`,
`pip-audit`, `PyYAML`) plus `setuptools>=84.0.0` at `:19`, which is exactly the current release (84.0.0).
Those 18 are not a gap by the range definition — an unpinned name has no ceiling to be under — but they are
the larger reproducibility hole, and they are what CI installs.

### 5.2 The base image — 1 gap, and it is a pre-release

```
FROM python:3.15.0rc2-slim-bookworm@sha256:1776b3fd7a71293417958958442a2ee7a7e7098f952a9c65b3b1c65de629aee7
```

— [`Dockerfile:1`](../../../../.agent-resources/DanyAPI-prod/Dockerfile)

**The digest is correct and the pin is real.** `docker manifest inspect` and the Docker Hub tag API both
report `3.15.0rc2-slim-bookworm` with index digest `sha256:1776b3fd7a71293417958958442a2ee7a7e7098f952a9c65b3b1c65de629aee7`
— byte-identical to the line above, and an OCI **index** rather than a single-architecture manifest, so it
resolves on amd64, arm64, arm, 386 and ppc64le. Tag *plus* digest is the correct form; this is the one place
in the whole coupling that is properly pinned.

The gap is the version, not the pin:

| Tag | Exists | Last pushed | Note |
|---|---|---|---|
| `3.15.0rc2-slim-bookworm` | yes | 2026-09-19 | **the pinned tag — a release candidate** |
| `3.15.0-slim-bookworm` | yes | 2026-10-13 | the stable release of the same Python version |
| `3.15.0-slim-trixie` | yes | 2026-10-14 | stable, newer Debian suite |
| `3.14-slim-bookworm` | yes | 2026-10-06 | the previous minor |
| `3.13-slim-bookworm` | yes | 2026-10-06 | |
| `slim-bookworm` | yes | 2026-10-13 | the moving default |

Classification: **pre-release → stable, same Python minor, 1 gap.** Python 3.15.0 shipped; the image is
still built `FROM` its release candidate. Bookworm versus trixie is a suite-currency note, not a defect —
both are current and supported.

The same version has a second, sharper expression inside the build. `pyproject.toml:3` sets
`target-version = "py310"`, `pyproject.toml:21` sets `python_version = "3.12"` for mypy, CI tests
`["3.10", "3.11", "3.12", "3.13", "3.14"]`, `app.py:9` enforces `MIN_PYTHON = (3, 10)`, and the shipped
image runs **3.15.0rc2**. Five different statements of the supported Python, none of them 3.15. **That is
the real currency problem: the interpreter the image runs is not in the tested matrix at all.**

### 5.3 The fork's build inputs — 3 moving, 0 pinned

Repeated from §4.3 because it belongs in the currency column: `FROM python:3.14-slim` (a moving tag, no
digest, `Dockerfile:1`), seven bare package names (`requirements.txt:1-7`), and a `main`-HEAD source clone.
None of the three is pinned, and all three are what the running container is actually made of.

## 6. Single-point-of-failure analysis

Three scenarios, each traced through the code that would carry them.

### 6.1 The fork is deleted

Everything still builds, and **nothing reports a problem** — because both failure paths are written to
select for success.

- **Attachment upload stops working, visibly.** `danyapi.ts:45` POSTs to `127.0.0.1:8000/v1/files`; with no
  container the fetch is rejected and `/api/upload` returns **502** with the error text
  ([`index.ts:344-357`](../../orchestrator/src/index.ts)). This one fails loudly. Good.
- **Chat stops working, visibly.** The provider throws and the router turns it into a `CHAT_ERROR`
  broadcast. Good.
- **The bootstrap reports success anyway.** With the repository gone,
  [`bootstrap/index.ts:65-69`](../../orchestrator/src/bootstrap/index.ts) takes the catch branch,
  `mkdirSync(danyDir, { recursive: true })` and then sets **`danyReady = true`** on an empty directory. The
  same happens on a clone that returns non-zero — `:62-63`. So `/health` and `/api/settings/load` both
  report `danyApiReady: true` for a directory that contains nothing.
- **The supervisor then reports a healthy container that does not exist.** The clone carried the
  `docker-compose.yml`; the stub did not, so `docker compose up -d` at
  [`supervisor.ts:139`](../../orchestrator/src/processes/supervisor.ts) fails. The code warns
  (`:147`) and **does not return** — it proceeds to poll for health for 10 s and then, on timeout, sets
  `service.status = 'running'` with the comment `// Container is up, proxy still warming up`
  ([`supervisor.ts:167`](../../orchestrator/src/processes/supervisor.ts)). `service_state` in SQLite and
  the plugin row both record `running`.
- **The UI agrees.** The Engine tab's DanyAPI card renders a static green dot and the literal text
  **"Docker Active"** with no binding to `harness.services`. It has never been able to show anything else.

Net effect: the user sees a green engine, a green plugin, a healthy `/health`, and a chat that always
errors. Two independent happy-path selections stack on the same failure.

### 6.2 The image is retagged

**Almost no exposure, because the tag is not used.** `ghcr.io/mindflowgo/danyapi:latest` is referenced only
in three prose lines of `ARCHITECTURE.md`. No code pulls it, so a retag changes nothing in a running
Conclave. The exposure is the reverse: the documentation describes an artefact that is not what the app
runs, so anyone reasoning from `ARCHITECTURE.md:652` is reasoning about the wrong supply chain.

The tag does carry one real risk for anyone who *does* follow the docs: `latest` on a fork is rebuilt only
when that fork pushes. The three published tags are `latest`, `sha-f65b3b7`, `sha-4aa38e0` and
`sha-e551331`, and the fork's newest commit is `e551331` (2026-09-07) — so `:latest` has been frozen for
over five weeks and will not move until someone pushes to `mindflowgo/DanyAPI` again. A stale `latest` is
its own failure mode, and it is the one the documentation invites.

### 6.3 The API changes under `:latest`

Not reachable through the tag, but reachable through the clone, which is a *moving branch* and gets
`git pull`ed on every dev boot ([`bootstrap/index.ts:71-78`](../../orchestrator/src/bootstrap/index.ts)).
The fork's `main` is a rebase relic — `e551331` is literally *"Merge upstream/main into main"* — so a future
merge brings upstream's refactors into the running build with no version boundary at all.

The direction of that change is known and already visible, because the snapshot is a later point on the
same line: upstream **deleted `/v1/files` and `/v1/sessions`, renamed the DeepSeek ids to
`deepseek-v4.1-flash`, and moved attachments onto the chat request as `files[]`** (§2, §4.1, §4.5). So the
next rebase of the fork onto upstream breaks, in one step:

| Breaks | Why |
|---|---|
| `DanyApiProvider.uploadFile()` — `danyapi.ts:45` | `POST /v1/files` 404s; the 404 retry at `index.ts:302` re-sends the *same* URL and also 404s |
| `POST /api/upload` — `index.ts:243-364` | returns 502 on every attachment, because both the attempt and the retry fail |
| `deleteProviderSessions()` — `index.ts:54` | already 404s (§4.4); upstream has no sessions API to fix it to |
| all four DeepSeek model ids | unknown-model 404s; `-thinking` has to become `thinking: true` |
| the MCP scaffolds' `model` default | `builtin.ts` and `mcp.js` default to `deepseek-v4-flash` |

Nothing in the tree validates any of it at startup. `isAvailable()` ([`danyapi.ts:18`](../../orchestrator/src/providers/danyapi.ts))
does one `GET /v1/models` and returns `res.ok`; `pingService` does the same and returns `res.ok`. Neither
checks that any declared model id appears in the response, and neither checks that `/v1/files` exists. A
container serving a completely different model set passes both health checks.

**The asymmetry is the finding.** The one input that is genuinely pinned — the snapshot's base image digest
— is the one input Conclave does not use. The three inputs Conclave does use are all unpinned moving
references, and the two code paths that would notice are both written to report success.

## 7. What is already good

Stated so the list above reads as a signal rather than a complaint.

- **The snapshot is properly engineered.** `Dockerfile:31-38` creates a non-root user (`uid 10001`),
  `chown`s `/app`, and drops to it; `:40-41` ships a real `HEALTHCHECK`; `:23-26` compiles the PoW solver
  and then purges the compiler out of the layer. That is a better container than most projects manage.
- **Its base pin is exemplary** — tag plus multi-arch digest, verified byte-identical to the registry (§5.2).
- **Its CI pins actions by SHA**, with the version as a trailing comment:
  `actions/checkout@3d3c42e5… # v7`, `docker/build-push-action@c3c9e263… # v7` — the recommended form, and
  the opposite of what the fork's inputs do. `ci.yml` also runs a real smoke test: it builds the image,
  starts it with `BYOK=1`, polls `/health` 30 times, and dumps the container log on failure.
- **It has 86 test files** under `tests/` (85 `test_*.py` plus `conftest.py`), plus `pytest`, `hypothesis`, `bandit`, `pip-audit`, `xenon` and
  `vulture` in the dev requirements. Conclave has **zero tests and no CI** — the comparison is not close.
- **It cross-checks `.env.example` against `config.py` by a test**, which is why the 34-key example file is
  trustworthy as documentation.
- **On Conclave's side, the fallbacks are deliberate and commented.** `danyapi.ts:25` and
  `supervisor.ts:58` both `catch` and return `false` from a *predicate* — that is correct shape, not a
  swallow. `bootstrap/index.ts:37-38` explains in a comment why production runs skip the sandbox entirely,
  and `supervisor.ts:22-26` mirrors it. The reasoning is on the page.
- **`plugins/danyapi/plugin.json` is honest about what the plugin is** — "the container itself has no MCP
  server" — which is exactly right.

## 8. Method and queries

Files read in full or in the cited ranges: the snapshot's `README.md`, `app.py`, `pyproject.toml`,
`requirements.txt`, `requirements-dev.txt`, `Dockerfile`, `.env.example`, `docs/start.py`,
`docs/install.ps1`, `docs/install.sh`, `danyapi/api/models.py`, `danyapi/api/schemas.py`,
`danyapi/api/attachments.py`, `danyapi/api/core.py`, and a full route sweep of `danyapi/api/*.py`; the
fork's `danyapi/api/openai.py` (raw, 2800 lines), `README.md`, `LICENSE`, `Dockerfile`, `requirements.txt`,
`docker-compose.yml`; and in Conclave, `orchestrator/src/providers/danyapi.ts`, `bootstrap/index.ts`,
`processes/supervisor.ts`, `plugins/danyapi/plugin.json`, `plugins/danyapi/mcp.js`,
`plugins/builtin.ts`, `index.ts`, `builtin.ts`, `client/web/src/lib/stores/harness.svelte.ts`,
`client/web/src/routes/api/providers/+server.ts`, `ARCHITECTURE.md`.

Commands, all run 2026-10-15:

```powershell
rg -n '@app\.(get|post|put|delete|patch)\(' danyapi/api                      # snapshot routes
gh api repos/mindflowgo/DanyAPI --jq '{fork,parent:.parent.full_name,source:.source.full_name,pushed_at,license:.license.spdx_id,archived}'
gh api repos/FANATFANATA/DanyAPI                                            # 404
gh api -H 'Accept: application/vnd.github.raw' repos/mindflowgo/DanyAPI/contents/danyapi/api/openai.py
docker manifest inspect ghcr.io/mindflowgo/danyapi:latest
Invoke-RestMethod 'https://ghcr.io/token?scope=repository:mindflowgo/danyapi:pull&service=ghcr.io'   # -> tags/list
Invoke-RestMethod https://pypi.org/pypi/<pkg>/json                          # 9 packages
Invoke-RestMethod https://hub.docker.com/v2/repositories/library/python/tags/<tag>
```

Nothing was verified by running the container, by building the image, or by calling a live DanyAPI
endpoint — every "serves" verdict here is a read of the source plus a registry read, not an observed
response.

## Related

- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — §5 there is the short version
  of this page's coupling section
- [Conclave dependency audit](./conclave-dependency-audit.md) — the same currency method applied to
  Conclave's own 25 declared dependencies, which is where the two unpinned lockfile/manifest pairs live
- [DanyAPI hardening upgrades](./hardening-upgrades.md) — the prioritised fixes this review feeds
- [Upstream reuse rule](../../../../.cursor/rules/30-upstream-reuse.mdc) — a fork is a rebase obligation,
  which §6.3 is about
- [Documentation map](./index.md) — the map this page hangs from
