---
title: ConclaveAPI rebrand — base copy, run surface, rename footprint, container regression
topic: conclaveapi-rebrand
updated: 2026-10-15
status: current
---

# ConclaveAPI rebrand — base copy, run surface, rename footprint, container regression

This page is a read-only survey of **DanyAPI** — a local, OpenAI-compatible FastAPI gateway that proxies to
several upstream chat providers — taken on **2026-10-15**, ahead of forking it, renaming it **ConclaveAPI**
and optimising it. Nothing was changed: no tree was edited, no `git` state was touched, no container was
built. Every claim carries a `file:line` or a quoted symbol, and where the two local copies disagree the
disagreement is stated rather than resolved.

Trees read:

| Label | Path | Files | Container |
|---|---|---|---|
| **prod** | `.agent-resources/DanyAPI-prod/` | 210 | newer of the two (evidence in §1) |
| **ref** | `.references/DanyAPI/` | 180 | older of the two |
| **vendored** | `.agent-repositories/conclave/orchestrator/provider-build/` | 3 | Conclave's own build recipe, written over the checkout at boot |
| **pin** | fork `mindflowgo/DanyAPI` commit `e551331ed7d6` (2026-09-07), read from the GitHub API only | not cloned | what Conclave currently builds |

The fork was queried, not cloned: `gh api repos/mindflowgo/DanyAPI` reports `"default_branch": "main"`,
`"pushed_at": "2026-09-07T23:17:43Z"`, `"fork": true`, `"parent": "FANATFANATA/DanyAPI"`, `"license": "MIT"`,
two branches (`main`, `api-enhancements`), and `gh api repos/FANATFANATA/DanyAPI` answers **404** — the
upstream author's repository is gone, which is why Conclave has to own a copy.

---

## 0. Which local copy is the better base

**`prod` is the base.** The strongest single piece of evidence is the provider inventory: `prod` ships five
provider packages that `ref` does not have at all.

```
prod/danyapi/  aihorde  aistudio  alice  api  deepseek  duckai  gigachat  mcp  mistral  opencode  qwen  tools
ref/danyapi/   alice  api  deepseek  duckai  gigachat  qwen  tools
```

Corroborating, in descending strength:

- **Tests.** `prod/tests/` holds 86 files, `ref/tests/` holds 79. The seven-only-in-`prod` set is
  `test_aistudio.py`, `test_mcp.py`, `test_mcpagent.py`, `test_opencode.py`, `test_regression_fixes.py`,
  `test_regression_fixes2.py`, `test_regression_fixes3.py`, which matches the extra packages one for one.
- **Dependency floors.** Every shared pin is higher in `prod`: `fastapi>=0.142.2` vs `>=0.141.1`,
  `uvicorn>=0.54.0` vs `>=0.53.0`, `python-dotenv>=1.2.4` vs `>=1.2.3`, `certifi>=2026.7.22` vs `>=2024.2.2`.
  `prod` also splits `websockets` by interpreter (`>=17.2; python_version >= "3.11"`).
- **`.env.example`.** `prod` adds `OPENCODE_KEYS`, `MISTRAL_LOGINS`, `AISTUDIO_LOGINS`,
  `AISTUDIO_HEADLESS`, `AISTUDIO_STATE_DIR`, `AISTUDIO_DOH_URL`, `AIHORDE_API_KEYS`, `MCP_SERVERS`,
  `DANYAPI_MCP_SEARCH_ENABLED`, `DANYAPI_MCP_ITERATIONS`, and **drops** the four legacy names
  `ALICE_ENABLED`, `DUCKAI_ENABLED`, `BYOK_MODE`, `DANYAPI_BYOK_MODE` that `ref` still lists.
- **README.** `prod/README.md` is 30,135 B with sections `## OpenCode Zen`, `## Mistral Le Chat`,
  `## Google AI Studio`, `## Server-side tools, MCP`; `ref/README.md` is 16,564 B and has none of them.
- **`pyproject.toml`.** `prod` widens the Alice lint exemption from `"tests/test_alice.py"` to
  `"tests/test_alice*.py"`, which only matters once the Alice test files multiply.
- **`.dockerignore`.** `prod` adds `*.pem`, `*.key`, `*.secret`, `*.p12`, `*.pfx`, `*.zip`, `*.tar*`, `*.7z`,
  `references`, `.playwright-mcp`, and the negation `!danyapi/gigachat/russian_trusted_root_ca.pem`.
- **Timestamps**, weaker than all of the above because both trees are zip extractions: every file in `prod`
  carries one mtime, `2026-10-09 14:31`, while `ref` carries `2026-09-30 00:16` with its
  `docker-compose.yml` written at `00:20`. The mtimes prove only which archive was unpacked later; the
  content proves which revision is later.

**Neither local copy is the fork's tip, and both are far ahead of the pin.** The tree at `e551331` contains
`danyapi/tools.py` as a single module and a `danyapi/reg/` registration subpackage, and has **only**
`danyapi/deepseek/` and `danyapi/qwen/` under the package. Both local copies have `danyapi/tools/` as a
package, `danyapi/sseutil.py`, `danyapi/usage.py`, a split `danyapi/api/` package, and no `reg/` and no
`tools.py`. Both also carry `.github/workflows/sync-dev.yml`, which `e5513313` does not have. So the two
local copies descend from a line of development past the fork, and picking `prod` is picking the newest
revision that survives on this machine.

**One unexplained difference to record, not to guess at:** `prod` has no `docker-compose.yml` and no `.env`,
while `ref` has both. `ref/.env` is byte-identical to `ref/.env.example` (744 B each), which is what
`app.py`'s `ensure_env()` writes on a first run, so `ref` is a tree that has been started once. `prod` has
never been started and has no compose file. The pin's tree does have `docker-compose.yml`, so the compose
file existed in the lineage; whether the newer revision deleted it or the preservation step dropped it
cannot be decided from disk, and needs the upstream repository, which is 404. Treat `ref`'s compose file as
the reference copy and `vendored`'s as the authority, because Conclave writes its own at boot.

---

## 1. What it takes to run the thing

### 1.1 Entry point and startup path

The ASGI application is a single module-level object:

- `danyapi/api/state.py:11` — `app = FastAPI(title="DanyAPI")`
- `danyapi/api/core.py:1153` — `app.router.lifespan_context = lifespan`, where `lifespan` is defined at
  `core.py:160-161` under `@asynccontextmanager`
- `danyapi/api/core.py:1129-1136` — CORS added with `allow_origins = settings.cors_origins or ["*"]` and
  `allow_credentials=bool(settings.cors_origins)`
- `danyapi/api/core.py:1150-1151` — `app.mount("/docs", _DocsAssets(directory=str(docs_path), html=True))`,
  gated on `docs_path.is_dir()`; `_DocsAssets` (`core.py:1142-1147`) is an allow-list wrapper over
  `StaticFiles` that 404s anything outside `DOCS_ASSETS` (`core.py:1139`)

Every route is declared directly on that one object with `@app.<method>`. There are no `APIRouter`
instances and no `include_router` calls anywhere in the tree, and `danyapi/api/__init__.py` is empty, so
import order decides whether a route module's decorators run at all.

There are **four** entry points, and they differ:

| Entry | Path | What it does |
|---|---|---|
| `app.py` | `app.py:186-213` `main()` | `ensure_env()` → `build_solver(force=True)` → `load_dotenv()` → `uvicorn.run(...)` |
| `python -m danyapi` | `danyapi/__main__.py:9-21` | `uvicorn.run(...)` only: no `.env` creation, no solver build |
| `docs/start.py` | `docs/start.py:16` `REPO = "FANATFANATA/DanyAPI"` | pulls the latest GitHub release when `DANYAPI_AUTO_UPDATE` is on, then starts the server; refused when the working tree is dirty |
| container `CMD` | `Dockerfile` last line | `["python", "-m", "danyapi"]`, in all three Dockerfiles |

`app.py` is the only entry that self-heals. `ensure_env()` (`app.py:34-50`) creates `.env` from
`.env.example` with mode `0o600`, prints `Fill in DEEPSEEK_TOKENS / QWEN_TOKENS and run again.` and calls
`sys.exit(1)`, so a first `python app.py` run is expected to fail once by design. `build_solver(force=True)`
(`app.py:76-179`) is discussed in §1.4.

Host and port come from `settings`, and the defaults are `0.0.0.0:8000` (`config.py:213-214`,
`_env_str("DANYAPI_HOST", "0.0.0.0")` and `_env_int("DANYAPI_PORT", 8000, MIN_PORT, MAX_PORT)`). `app.py`
additionally passes `timeout_keep_alive=60` and `backlog=1024`, which `__main__.py` does not.
`config.py:92` — `_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"` — is loaded at **import** time
with `load_dotenv(dotenv_path=_ENV_PATH, override=False)` (`config.py:105`), guarded by an `except ImportError`
that swaps in `_noop_load_dotenv` (`config.py:95-103`), so a missing `python-dotenv` degrades to a warning
rather than a crash. `config.py` builds one `settings = Settings()` singleton at import (`config.py:286`) and
then calls `audit_credential_env_names()` (`config.py:287`), a self-check that re-reads its own source, regex-
extracts every env name passed to an `_env_*` helper (`config.py:74`) and warns about any name that is
neither in `CREDENTIAL_ENV_NAMES` (`config.py:28`) nor in `_NON_CREDENTIAL_ENV_NAMES` (`config.py:40`).

Endpoints, from the decorators:

```
/v1/chat/completions   chats.py:85          /v1/models              models.py:472
/v1/completions        chats.py:308         /v1/models/{model_id}   models.py:480
/v1/embeddings         chats.py:359         /                       openai.py:357
/v1/moderations        chats.py:365         /favicon.ico            openai.py:365
/v1/images/generations images.py:146        /health                 openai.py:442
/v1/images/edits       images.py:298        /v1/providers           openai.py:451
/v1/images/variations  images.py:329        /v1/usage               openai.py:463
/v1/tokens             envtokens.py:566     /v1/responses           openai.py:543
/v1/messages           openai.py:713        /v1/responses/{id}      openai.py:843,852,859,892
/v1/messages/count_tokens openai.py:780     /docs                   core.py:1151
```

`/v1/embeddings` and `/v1/moderations` are deliberate refusals: `chats.py:360` `embeddings_not_supported`
and `chats.py:366` `moderations_not_supported`, both routed through `_reject_unsupported_endpoint`
(`chats.py:371`).

**Two routes Conclave calls do not exist in either local copy.** Conclave's
`orchestrator/src/providers/sessions.ts:36` builds `${base}/sessions/${encodeURIComponent(tabId)}` with
method `DELETE`, and `orchestrator/src/index.ts:293-294` forwards uploads to a DanyAPI `/v1/files`. Neither
`/sessions` nor `/v1/files` appears in any `@app.` decorator in `prod` or `ref`, and there is no
`add_api_route`, no `add_route` and no `APIRouter(` anywhere in `prod/danyapi/`. This is Conclave-side drift,
already recorded as **C1** in `PROMPT.md:123`, and it is a rebrand input: the route is not a DanyAPI-owned
wire string to preserve, it is a mismatch to fix.

### 1.2 Every environment variable it reads

`prod/.env.example` lists 39 names and `config.py` reads 38 of them through `_env_*`; the 39th,
`DANYAPI_GIGACHAT_CA_FILE`, is read directly at `danyapi/gigachat/tls.py:143`. The set is exactly in sync in
both directions: no name in `.env.example` is unread anywhere under `danyapi/`, and no name `config.py` reads
is missing from `.env.example`. Three further names are read outside `config.py`, giving **41 for the
server**, plus one used only by the non-server helper `CAC.py`.

Required for a basic run: **none of them, technically, but the server refuses to start without a working
provider.** `core.py:436-451` raises when every pool is empty and BYOK is off:

```python
raise RuntimeError(
    "no valid credentials: set DEEPSEEK_TOKENS, QWEN_TOKENS, GIGACHAT_KEYS, OPENCODE_KEYS, "
    "MISTRAL_LOGINS or AISTUDIO_LOGINS, or disable unused providers via DANYAPI_DISABLED_PROVIDERS"
)
```

`alice` and `duckai` are keyless (`state.py:15` `KEYLESS_PROVIDERS = ("alice", "duckai")`) and `aihorde`
falls back to an anonymous key (`core.py:232` `keys = settings.aihorde_api_keys or [AIHORDE_ANON_KEY]`), so a
zero-config start succeeds only if the Alice endpoint answers or node is present for duck.ai. `BYOK=1`
short-circuits the whole credential path. `OPENCODE_KEYS` and `AIHORDE_API_KEYS` are optional by design
(`state.py:17` `KEY_OPTIONAL_PROVIDERS = ("opencode", "aihorde")`).

| Variable | Default (`config.py`) | What it does | Required | Supplied by |
|---|---|---|---|---|
| `DEEPSEEK_TOKENS` | empty | `:215` comma-separated DeepSeek web tokens | one provider needed | user |
| `QWEN_TOKENS` | empty | `:216` comma-separated Qwen web tokens | one provider needed | user |
| `GIGACHAT_KEYS` | empty | `:217` GigaChat authorisation keys, base64 `client_id:client_secret` | no | user |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | `:218` GigaChat scope | no | user, mirrored in `.env.example` |
| `DANYAPI_GIGACHAT_CA_FILE` | empty | `tls.py:143` overrides the bundled Russian root CA; a bad path raises `RuntimeError` (`tls.py:146,151`) | no | user |
| `OPENCODE_KEYS` | empty | `:219` OpenCode Zen keys | no | user |
| `ALICE_ACCOUNTS` | `1` | `:220` concurrent Alice connections, clamped 1..4 (`MAX_ALICE_ACCOUNTS`) | no | user |
| `DUCKAI_ACCOUNTS` | `1` | `:221` concurrent Duck.ai connections, clamped 1..4 | no | user |
| `MISTRAL_LOGINS` | empty | `:222` Le Chat `email:password` pairs | no | user |
| `AISTUDIO_LOGINS` | empty | `:223` Google `email:password` pairs | no | user |
| `AIHORDE_API_KEYS` | empty | `:224` AI Horde keys; empty uses the anonymous key | no | user |
| `AISTUDIO_HEADLESS` | on | `:225` `not _env_off(...)`, `0` shows the browser | no | user |
| `AISTUDIO_STATE_DIR` | empty | `:226` saved browser states | no | user |
| `AISTUDIO_DOH_URL` | `https://xbox-dns.ru/dns-query` | `:227` DNS-over-HTTPS resolver for Google hosts | no | user |
| `BYOK` | off | `:228` bring-your-own-key mode; `_env_on("BYOK", "")` | no | user |
| `DANYAPI_ADMIN_TOKEN` | empty | `:246` bearer for `POST /v1/tokens`, empty disables it (`envtokens.py:566`) | no | user |
| `DANYAPI_DISABLED_PROVIDERS` | empty | `:247` → `_disabled_providers()` `:255-260`, unknown names warned | no | user |
| `MCP_SERVERS` | empty | `:248` → `_mcp_servers()`, `name=command` or `name=url`, cap `MAX_MCP_SERVERS = 16` | no | user |
| `DANYAPI_MCP_SEARCH_ENABLED` | off | `:249` adds the built-in keyless DuckDuckGo tool (`core.py:455-456`) | no | user |
| `DANYAPI_MCP_ITERATIONS` | `8` | `:250` clamped 1..16 | no | user |
| `DANYAPI_HOST` | `0.0.0.0` | `:213` bind address | no | **Dockerfile** `ENV DANYAPI_HOST=0.0.0.0` |
| `DANYAPI_PORT` | `8000` | `:214` clamped 1..65535 | no | **Dockerfile** `ENV DANYAPI_PORT=8000` |
| `DANYAPI_TIMEOUT` | `60.0` | `:229` upstream timeout, positive float | no | user |
| `DANYAPI_ACQUIRE_TIMEOUT` | unset (wait forever) | `:230` `_env_float_opt`; consumed at `core.py:1122` | no | user |
| `DANYAPI_SESSION_CACHE_SIZE` | `128` | `:231` chats cached per provider | no | user |
| `DANYAPI_SESSION_TTL_SECONDS` | `3600.0` | `:232` `_env_float(..., minimum=0.0)`, `0` never expires | no | user |
| `DANYAPI_CACHE_DIR` | empty → `%TEMP%/danyapi-<uid>` | `:237`; `store.py:128` | no | user |
| `DANYAPI_CACHE_DISABLED` | off | `:238` `cache_enabled = not _env_on(...)` | no | user |
| `DANYAPI_BYOK_AUTH_TTL_SECONDS` | `300.0` | `:239` BYOK token-check cache | no | user |
| `DANYAPI_MODELS_REFRESH_SECONDS` | `900.0` | `:240` background model refresh | no | user |
| `DANYAPI_USAGE_ENABLED` | on | `:241` `not _env_off(..., "1")` | no | user |
| `DANYAPI_USAGE_MAX_RECORDS` | `1000` | `:242` | no | user |
| `DANYAPI_AUTO_UPDATE` | on | `:243` read by `docs/start.py` (`env_flag`), **not** by the server | no | user |
| `DANYAPI_CORS_ORIGINS` | empty | `:244` `_env_list`; empty means `["*"]` (`core.py:1129`) | no | user |
| `DANYAPI_RESPONSES_MAX_RECORDS` | `1024` | `:245` `/v1/responses` records kept | no | user |
| `DANYAPI_LOG_LEVEL` | `INFO` | `:233` `_env_str(...) or "INFO"` | no | user |
| `DANYAPI_LOG_FILE` | empty | `:234` empty logs to console only | no | user |
| `DANYAPI_LOG_MAX_BYTES` | `10485760` | `:235` rotation size | no | user |
| `DANYAPI_LOG_BACKUP_COUNT` | `3` | `:236` rotations kept | no | user |
| `DANYAPI_DUCKAI_NODE` | empty | `attest.py:151-155` node executable override; a non-runnable path yields `None` and duck.ai hard-fails | no, but duck.ai needs node | user |
| `POW_SOLVER_THREADS` | solver's own | `deepseek/pow_solver.c:451` `getenv("POW_SOLVER_THREADS")`, passed through by `pow.py:87` inside `_SOLVER_ENV_ALLOWLIST` | no | user |
| `CAC_API_URL` | `CAC.py:261` | client-side helper `CAC.py` only; not the server, second env prefix in the tree | n/a | user |

What the container image supplies versus what a user must set: the **image** sets exactly two,
`DANYAPI_HOST=0.0.0.0` and `DANYAPI_PORT=8000`, in all three Dockerfiles, plus `PYTHONUNBUFFERED=1` (all
three) and `PYTHONDONTWRITEBYTECODE=1` (prod and ref only). **Conclave's bootstrap writes a `.env`** the
first time: `orchestrator/src/bootstrap/index.ts:145-150` emits a file whose whole content is a comment plus
`DANYAPI_HOST=0.0.0.0` and `DANYAPI_PORT=8000`, or copies `api_sandbox/DanyAPI_settings` over it if that
exists (`:135-142`). Everything else is the user's. There is no `compose` file anywhere that supplies
credentials; the two compose files use `env_file: ./.env`.

Names `prod` dropped since `ref`: `ALICE_ENABLED`, `DUCKAI_ENABLED`, `BYOK_MODE`, `DANYAPI_BYOK_MODE`.
`ref` still documents them (`ref/README.md:107,109,111`, `.env.example:6,8,30,31`) and its repo guard maps
all three BYOK spellings onto one (`ref/tests.py:65-67`), and `ref/tests/conftest.py:6` still sets
`os.environ["BYOK_MODE"] = "0"`. `prod` reads only `BYOK`, so a migrated deployment should carry
`ref/.env` forward as `BYOK=` and drop the rest.

### 1.3 Runtime dependencies, and which are real

`prod/requirements.txt` (9 names) against the actual `import` statements under `danyapi/`:

| Declared | Imported where | Verdict |
|---|---|---|
| `fastapi>=0.142.2` | `api/openai.py:15-18`, `api/core.py:22,24`, `api/state.py:7` | real |
| `uvicorn>=0.54.0` | `app.py:198`, `danyapi/__main__.py:3` | real |
| `httpx>=0.28.1` | `deepseek/client.py:76`, `qwen/client.py:116`, `aihorde/client.py:203`, `duckai/client.py:461`, `opencode/client.py:193`, `gigachat/client.py:114`, `mcp/transport.py:208`, `mcp/registry.py:65`, `aistudio/doh.py:138`, `alice/client.py:577`, `api/images.py:161` | real |
| `pydantic>=2.13.5` | `api/schemas.py`, `api/responses.py` | real |
| `python-dotenv>=1.2.4` | `config.py:103`, `api/envtokens.py` (`dotenv_values`) | real, but imported behind a fallback (`config.py:97-107`) |
| `pillow>=12.3.0` | `api/images.py:60` `from PIL import Image`, lazily inside a function | real |
| `python-multipart>=0.0.32` | **not imported anywhere** | declared-but-unimported as a module; functionally required, because `fastapi.File`/`fastapi.Form` parse `multipart/form-data` and `api/byok.py:258-278` handles that content type explicitly |
| `websockets>=17.2` (and `>=13.0` below 3.11) | `alice/client.py:12-14,422` `websockets.connect(` | real; needed only for the Alice provider |
| `certifi>=2026.7.22` | `aistudio/doh.py:11`, `gigachat/tls.py:28` | real |

**Imported but not declared, across the whole package**: `httpcore` (`aistudio/doh.py:12`,
`aistudio/client.py:12,161` `httpcore.AsyncConnectionPool`) and its private backend
`httpcore._backends.anyio` (`aistudio/doh.py:14`), plus `starlette` (`api/core.py:25`
`from starlette.types import Scope`, and `StaticFiles` at `core.py:24`). Both are transitive: `httpcore` and
`certifi` come with `httpx`, `starlette` with `fastapi`. Nothing declares them, and
`aistudio/doh.py:14` reaches into a private module, so a future `httpcore` minor release can break the
Google AI Studio provider without any declared dependency changing. This is the dependency-audit target:
the honest fix is to declare `httpcore` and `starlette` directly, not to vendor them.

**`requirements-dev.txt`** is `-r requirements.txt` plus 20 tools:
`ruff pytest pytest-asyncio pytest-cov pytest-xdist hypothesis mypy pyright pylint flake8 pyflakes isort
bandit vulture xenon pip-audit PyYAML setuptools>=84.0.0`. `prod` adds `pytest-xdist`, which `ref` does not
have; `pytest-cov` is in both. What the tests actually import beyond those: `hypothesis`
(`given`, `strategies as st`), `pytest` fixtures, `fastapi.testclient.TestClient`,
`unittest.mock`, `starlette.datastructures.UploadFile`, `starlette.requests.Request`, and stdlib
`http.server.ThreadingHTTPServer`, `runpy`, `importlib`, `zipfile`, `xml.etree.ElementTree`.

`tests.py` at the repo root is **not** a test module. It is the lint and guard driver:
`tests.py:32-39` defines `PYTHON_TARGETS = ["danyapi", "tests", "docs", *ROOT_SCRIPTS"]`, `BANDIT_SKIPS`,
`C_SOURCES = ["danyapi/deepseek/pow_solver.c"]` and a `clang-tidy` check string, and `tests.py:41-45`
maintains a banned-pattern list (em dash, en dash, `"live demo"`, emoji ranges, `"generated by"`,
`"co-authored-by"`). CI invokes it as `python tests.py --full` (`.github/workflows/ci.yml:62`), and that is
the only test command CI runs. The pytest suite under `tests/` is wired by `pyproject.toml`'s
`[tool.pytest.ini_options]` with `testpaths = ["tests"]` and `asyncio_mode = "auto"`.

`pyproject.toml` has **no `[project]` table and no `[build-system]`**. It is pure tool configuration
(`ruff`, `pytest`, `mypy`, `pyright`, `vulture`, `isort`). Consequences for the rebrand and for packaging:
there is no console-script entry point, no declared package name, and `pip install -e .` is not a supported
path. Every invocation is `python app.py`, `python -m danyapi`, or the image `CMD`.

### 1.4 Everything that is not Python

**The proof-of-work solver (C).** Source `danyapi/deepseek/pow_solver.c`, 17,658 B. Built in every
Dockerfile by the same line (prod Dockerfile, ref Dockerfile, vendored `Dockerfile:33`):

```sh
gcc -O3 -pthread -funroll-loops -flto -fomit-frame-pointer -o danyapi/deepseek/pow_solver danyapi/deepseek/pow_solver.c
```

No `-l` flags, so it links only against libc and pthread; `nodejs` is in the same `apt-get install` line and
`gcc`/`libc6-dev` are purged afterwards. It reads `POW_SOLVER_THREADS` itself (`pow_solver.c:451`). It is
also rebuilt at runtime by `app.py:build_solver` (`app.py:76-179`): candidate paths are tried in order
(`app.py:77-82`), the compiler is chosen from `["gcc", "clang", "cl"]` on Windows and `["gcc", "clang", "cc"]`
elsewhere (`app.py:110`), the fast flags include `-march=native -mtune=native -funroll-loops` (`app.py:132`),
and a failing fast build falls back to `-O3` alone (`app.py:151-166`). Resolution order is
`danyapi/deepseek/pow_solver[.exe]` via `_native_solver_names()` / `_find_native_solver()`
(`pow.py:257-268`).

**The JavaScript solvers and the WASM blob.** These are two different mechanisms with different weights:

- `danyapi/deepseek/pow_solver.js`, 8,310 B. Invoked as `node pow_solver.js` (`pow.py:359`
  `cmd = ["node", str(script)] if script.suffix == ".js" else [str(script)]`), JSON on stdin, JSON on
  stdout, validated in `_run_solver` (`pow.py:344-394`). Line 3-4 is
  `const wasmPath = path.join(__dirname, "sha3_wasm_bg.wasm"); const useWasm = fs.existsSync(wasmPath);`, so
  `danyapi/deepseek/sha3_wasm_bg.wasm` (26,612 B) is **optional** and the same file carries a pure-JS path.
  The JS rung is the second of three, not required: `pow.py:432`
  `for solver in (solve_native, solve_node, solve_python)`, and each failure is caught and the next tried
  (`pow.py:440-442`). Missing native binary raises `FileNotFoundError("native pow_solver binary not built")`
  (`pow.py:407`); missing JS raises `FileNotFoundError("pow_solver.js not found")` (`pow.py:420`); a missing
  `node` on `PATH` surfaces as `OSError` from `subprocess.Popen` and becomes
  `RuntimeError(f"{script.name} is not executable: {exc}")` (`pow.py:369-370`). The child environment is
  filtered to `_SOLVER_ENV_ALLOWLIST` (`pow.py:65-88,308`), so the solver never sees a token.
- `danyapi/duckai/jsa_solver.js`, 37,567 B, is **required** for the duck.ai provider. `attest.py:26`
  `JSA_SCRIPT = Path(__file__).resolve().parent / "jsa_solver.js"`; `attest.py:263-264` raises
  `AttestationError(f"attestation solver is missing: {JSA_SCRIPT.name}")`; `attest.py:262` raises
  `AttestationError("node is required to solve the duckai attestation, set DANYAPI_DUCKAI_NODE or install
  node")`. It is spawned at `attest.py:200-204` with `stdio=PIPE` on all three streams and a deliberately
  scrubbed environment (`attest.py:70` spells out why). `attest.py:280`
  `return await asyncio.to_thread(evaluate_sync, script, user_agent)` keeps the blocking `communicate()` off
  the event loop. Failure modes: `runtime` failure returns `{ok: False}` up the retry ladder
  (`duckai/client.py:591` catches `AttestationError`), and `duckai/api.py:446` maps a final
  `AttestationError` to a client-visible error.

**Every place the code shells out.** `pow.py:361` (`Popen`, native binary or `node`), `attest.py:200`
(`Popen`, `node jsa_solver.js`), `app.py:145,155,168` (`subprocess.run`, `cl` / `gcc` / `clang`),
`danyapi/mcp/transport.py` `StdioTransport` (spawns the `MCP_SERVERS` child processes), and
`mcp/transport.py:81` `environment = dict(os.environ)` which hands the MCP child the full parent
environment. Outside the server: `docs/setup.py:218` (`env = os.environ.copy()`), `docs/start.py`
(`urllib.request` plus subprocess for the release update), `CAC.py:7`, `collecter.py`. `bandit.toml`
documents the exposed call table, listing `subprocess.Popen/call/run/check_call/check_output` and the
`os.system`/`os.popen` family.

### 1.5 State

Written to disk:

- `cache_root()` (`store.py:127-148`) = `$DANYAPI_CACHE_DIR` if set, else
  `Path(tempfile.gettempdir()) / _user_root_tag()` where `_user_root_tag()` is `danyapi-<uid>` on POSIX and
  `danyapi-<getpass.getuser()>` on Windows (`store.py:112-124`). `_root_rejection` (`store.py:99-109`)
  refuses a symlink or a root not owned by the current uid, and both failures fall back to the temp root and
  then to `mkdtemp` (`store.py:130-142`). The directory is created `0o700` (`store.py:144-145`).
- Files are `<name>-<scope>.json` with non-alphanumerics replaced by `_` (`store.py:167-169`). The lifespan
  creates `deepseek-sessions`, `qwen-sessions`, `deepseek-contexts`, `qwen-contexts`, `deepseek-affinities`,
  `qwen-affinities`, `responses` (`maxsize=settings.responses_max_records`) and `usage`
  (`core.py:178-195`). Gigachat combines its bundled Russian root with the system bundle into
  `gigachat-ca-bundle.pem` in the same directory (`tls.py:172`).
- Writes are `0o600`, `fsync`ed and committed by `os.replace` on to a `.tmp` sibling (`store.py:241-247`),
  capped at `_MAX_STORE_BYTES = 64 * 1024 * 1024` (`store.py:28`) with an oversized file ignored on load
  (`store.py:204-206`).
- `DANYAPI_CACHE_DISABLED=1` makes `scope=None` for every store, and `store.py:167`
  `if scope and settings.cache_enabled` means `_path` stays `None` and nothing is written at all.

**Nothing needs a volume, and nothing survives one.** No `VOLUME` instruction exists in any of the three
Dockerfiles, and neither compose file declares a volume for the cache. Read the cache path carefully: the
Dockerfiles run `mkdir -p /tmp/danyapi && chown -R 10001:10001 /app /tmp/danyapi`, but the runtime path for
uid 10001 is `/tmp/danyapi-10001` (`store.py:115`), so that `chown` targets a directory the application
never uses. The application still succeeds because `/tmp` is world-writable and it creates the real
directory itself with mode `0700`. Lost on every container recreate: every session, every context, every
affinity, every `/v1/responses` record, every usage counter, and any `gigachat-ca-bundle.pem` regenerated
each boot. BYOK key pools and their auth cache are in-memory only (`state.py:69-97`, `core.py:173-176`).
Sessions are also the only cross-process boundary Conclave relies on, keyed by `session_id` = tab id
(`orchestrator/src/providers/danyapi.ts` sends it per request), so a container recreate silently drops
multi-turn memory upstream. That argues for a named volume on the cache path in the ConclaveAPI image, and
it is a decision a rebrand should make deliberately rather than inherit.

### 1.6 Licence and attribution

`LICENSE`, verbatim line 1: `MIT License`. Line 3: `Copyright (c) 2026 FANATFANATA`. Both local copies are
byte-identical on the first three lines; `prod` is 1,067 B and `ref` 1,087 B, both the unmodified MIT text.
`gh api repos/mindflowgo/DanyAPI` reports `"license": {"spdx_id": "MIT"}` for the fork too, so the licence
chain is MIT the whole way and the rebrand keeps MIT with the original copyright line intact.

Everything in the tree that names the original author or the upstream repository, and so needs an
attribution decision rather than a rename:

| File:line | Names |
|---|---|
| `LICENSE:3` | `Copyright (c) 2026 FANATFANATA` |
| `README.md:5,6,8,9` | CI, release and GHCR badges pointing at `FANATFANATA/DanyAPI` |
| `README.md:32,38` | install one-liners from `raw.githubusercontent.com/FANATFANATA/DanyAPI/prod/` |
| `README.md:49` | `ghcr.io/fanatfanata/danyapi:latest` |
| `README.md:292` | `[Creator](https://t.me/DanyaVoredom)`, `[Telegram channel](https://t.me/DanyAPIFree)`, `fanatfanata.github.io/DanyAPI` |
| `web/index.html:6,396` | `<title>DanyAPI</title>`, GitHub link |
| `docs/index.html:6,49,79,271,273,276,278,337,363` | title, install commands, GitHub links |
| `docs/script.js:385` | `fetch("https://api.github.com/repos/FANATFANATA/DanyAPI")` |
| `docs/install.ps1:3`, `docs/install.sh:3` | `$RepoUrl` / `REPO_URL` |
| `docs/start.py:16` | `REPO = "FANATFANATA/DanyAPI"` |
| `docs/token_utility.py:64` | `"footer_github_url"` |
| `CAC.py:18,23` | `DEFAULT_REPO = "FANATFANATA/DanyAPI"`, `CDN_REPO = "FANATFANATA/cdn"` |
| `.github/workflows/ci.yml:79,147` | `images: ghcr.io/${{ github.repository }}` (slug-derived, no literal) |

Judgement call for the rebrand: MIT's one obligation is that the copyright notice and the permission notice
travel with the copy, so `LICENSE` stays exactly as it is. The GitHub and Telegram links are the author's
identity, not licence text, and a fork that rewrites them should record the original in the README rather
than delete it. The GHCR image name and every `FANATFANATA/DanyAPI` URL must change, because they point at
a repository that no longer exists.

---

## 2. The rebrand footprint

Counts are from `rg` over `prod`, case-insensitive: **163 of 210 files** contain `danyapi`;
**1,311 matching lines**; **89 files / 565 lines** of `from|import danyapi`; **29 files / 255 lines** of
`DANYAPI_[A-Z0-9_]+`.

### 2.1 Inside the provider tree

The distinction that matters: **code that must change to work** means the rename cannot land without it;
**prose that should change for coherence** means the software runs either way and the change is for a
consistent product.

**A. Code that must change to work**

| # | Site | Files / counts | Evidence |
|---|---|---|---|
| A1 | Package directory `danyapi/` and every absolute import of it | 89 files, 565 lines | `from danyapi.config import settings` (`danyapi/__main__.py:14`); relative imports such as `from ..config import settings` inside the package do **not** move |
| A2 | Module entry point `python -m danyapi` | image `CMD` in all three Dockerfiles; `README.md:63`; `docs/setup.py:865` | vendored `Dockerfile:44` `CMD ["python", "-m", "danyapi"]` |
| A3 | ASGI import string `"danyapi.api.openai:app"` | 3 sites | `app.py:206`, `danyapi/__main__.py:19`, `tests/test_main.py:21`; asserted by `test_main.py` |
| A4 | Env-var prefix `DANYAPI_*` | 25 real names, 29 files / 255 `DANYAPI_*` lines | `config.py:213-250`; the 15 credential names (`DEEPSEEK_TOKENS`, `BYOK`, `MCP_SERVERS`, …) carry no prefix and do not move |
| A5 | `_SOLVER_ENV_ALLOWLIST`-adjacent literals and `.dockerignore` path patterns | 2 files | `.dockerignore` `pow_solver`, `collecter.py`, `collected.xml`, `.DanyAPI.staging-*/`, `.DanyAPI.old-*/`; the staging/old names mirror `docs/start.py:22-23`'s `TAG_FILE`/`TAG_CACHE` rollback scheme |
| A6 | Container and image names | vendored `docker-compose.yml:12` `container_name: danyapi`, `:10` service `danyapi`; `README.md:49`; `ci.yml:79,147` | the service name is asserted by Conclave (`compose.ts:69`) |
| A7 | `pyproject.toml` lint paths | 4 lines | `known_first_party = ["danyapi"]`; `per-file-ignores` for `"danyapi/alice/*.py"` and `"tests/test_alice*.py"` |
| A8 | Distribution helper `DEFAULT_REPO` / `CDN_REPO` | 2 lines | `CAC.py:18,23` |

**B. Prose that should change for coherence**

| # | Site | Files / counts | Evidence |
|---|---|---|---|
| B1 | FastAPI title and startup log line | 2 | `api/state.py:11` `FastAPI(title="DanyAPI")`; `logging.py:34` `DANYAPI_RUNNING = "DanyAPI running on"`, used at `logging.py:130-131` to rewrite uvicorn's banner |
| B2 | `README.md` | 49 mentions | 292 lines total, four provider sections `prod` added |
| B3 | `docs/` | 13 files, 42+ mentions in `setup.py`, 45 in `start.py`, 21 in `index.html`, 16 in `script.js`, 12 in `install.ps1`, 11 in `install.sh`, 13 in `token_utility.py` | static site plus installer |
| B4 | `web/index.html` | 17,136 B, one `<title>` and one link | served at `/` by `api/openai.py:357-362` |
| B5 | Test names and fixtures | 86 test files, `tests.py:30` `OPTIONAL_ROOT_SCRIPTS`, `tests/conftest.py` env list | `tests/test_*` reference `danyapi.` module paths, so most of these are A1 by proxy |
| B6 | `.github/` | `dependabot.yml`, `PULL_REQUEST_TEMPLATE.md`, three workflows | workflow branch names are `prod`/`dev`, which is a second naming decision the rebrand has to make |

Three of these are worth calling out because they are cheaper to do at rename time than after: `A3` and
`A2` are single strings that a rename script can miss when it only rewrites `danyapi/`; and `B1`'s
`DANYAPI_RUNNING` is the string a user sees in their logs, so leaving it is the most visible half-rebrand.

### 2.2 Conclave-side references

`rg -i danyapi` over Conclave excluding `node_modules/` returns **523 matching lines across 46 files**,
plus three lines in Zedon's `PROMPT.md`. **None of these were touched.** Grouped by what each is:

| Files | What the hit is |
|---|---|
| `orchestrator/src/bootstrap/pin.ts:12,19,22,25,26,27,65,73` | the pin: `DANYAPI_REPO = 'https://github.com/mindflowgo/DanyAPI.git'`, `DANYAPI_COMMIT = 'e551331…'`, and the three persisted setting keys `danyapi_pinned_commit`, `danyapi_commit`, `danyapi_image` |
| `orchestrator/src/bootstrap/index.ts` (36 lines: `:8-10,18,22,43,61-62,71-95,103,115,127,132-151,163,176,182,198-220`) | the clone/verify/overwrite step: sandbox `<data or api_sandbox>/DanyAPI`, the `.env` template at `:145-147`, `repos.setSetting('danyapi_port', '8000')` at `:176`, `danyApiReady` at `:182` |
| `orchestrator/src/bootstrap/compose.ts:5,69` | the compose contract: `expectedService: string = 'danyapi'`, `expectedPort: number = 8000` |
| `orchestrator/src/bootstrap/ready.ts:2,13,19,21,26,27,38` | `assessDanyApi(dir)`, which decides the checkout under `<dir>/DanyAPI` is runnable |
| `orchestrator/src/db/index.ts:72,75` | seeded settings: `deepseek_endpoint` = `http://127.0.0.1:8000/v1` and `danyapi_port` = `8000` |
| `orchestrator/src/providers/danyapi.ts` (12 lines: `:5,14,15,16,65,121,151,167,175,182,189,200`) | `DANYAPI_MODELS`, `class DanyApiProvider`, `name = 'DanyAPI'`, `danyApiProvider` singleton |
| `orchestrator/src/providers/index.ts:2,6,11,21,24` | the registry: `getProvider` routes `deepseek`, `dany`, `qwen`, `default` and the empty string to `danyApiProvider` |
| `orchestrator/src/providers/endpoint.ts:6,16,17` | `DEFAULT_PROVIDER_ENDPOINT = 'http://127.0.0.1:8000/v1'` and the `deepseek_endpoint` setting name |
| `orchestrator/src/providers/sessions.ts:4,36` | `deleteProviderSession`, the `DELETE <endpoint>/sessions/<tabId>` call |
| `orchestrator/src/processes/supervisor.ts:6,23,45,70-73,97-98,112,118,127,146-150,165-274` | the health probe on `http://127.0.0.1:8000/v1/models`, `docker compose up -d`, `docker compose logs -f`, `[DanyAPI]` log prefix |
| `orchestrator/src/plugins/index.ts:20-24,197-199,501,516-518` | built-in plugin seeding; `manifest.serviceName || 'DanyAPI'` default at `:501` |
| `orchestrator/src/plugins/builtin.ts` (11 lines, 4,766 B) | the second copy of the plugin manifest and scaffold; its header at `:15` names `ask_deepseek / ask_qwen / ask_zai` while `plugins/danyapi/plugin.json` declares only two tools |
| `orchestrator/plugins/danyapi/plugin.json` | plugin id `danyapi`, `serviceName: "DanyAPI"`, port 8000, six model ids, two MCP tools |
| `orchestrator/plugins/danyapi/mcp.js` | the scaffold's `call(toolName, args, ctx)` |
| `orchestrator/src/mcp/index.ts:83,147` | the port/status tool description and `plugin_danyapi_${toolName}` matching |
| `orchestrator/src/index.ts:32,251,293-360` | the `/api/upload` branch forwarding to `/v1/files` and the `danyApi` field in its response |
| `orchestrator/src/router/index.ts:35`, `orchestrator/src/surface.ts:49,61` | a comment and the `danyApiReady` field of the public bootstrap projection |
| `orchestrator/provider-build/Dockerfile`, `docker-compose.yml`, `constraints.txt` | the vendored build recipe (see §4) |
| `orchestrator/tests/pin.test.ts` (18), `inflight.test.ts` (14), `bootstrapReady.test.ts` (12), `surface.test.ts` (12), `buildRecipe.test.ts` (5), `endpoint.test.ts` (1) | assertions that encode the pin, the service name `danyapi` and port 8000, and `danyApiReady` |
| `client/web/src/lib/stores/harness.svelte.ts:9`, `routes/api/providers/+server.ts:7` | the display name `'DeepSeek (DanyAPI)'` |
| `client/web/src/routes/(desktop)/settings/+page.svelte:462,468,474,480,792,801` | the plugin tool labels `plugin_danyapi_ask_deepseek` / `plugin_danyapi_ask_qwen` and the settings copy |
| `client/web/src/lib/components/PromptInput.svelte:144`, `lib/services/promptDeadline.ts:12` | log text and a doc comment naming `providers/danyapi.ts` |
| `ARCHITECTURE.md:3,41,61,72,120,121,124,139,189,191,277,287,307,313,323,333,356,608,651,664`; `UI-PROTOCOL.md:24,118,275,277` | the two top-level design documents, including `ghcr.io/mindflowgo/danyapi:latest` |
| `.cursor/documents/danyapi-review.md:94`, `hardening-upgrades.md:84`, `wiring-audit.md:29`, `conclave.md:28`, `features.md:26`, `upgrade-plan.md:7`, `proxima-comparison.md:6`, `mcp-roadmap.md:5`, `conclave-dependency-audit.md:3`, `index.md:2` | Conclave's own wiki |
| `PROMPT.md:123,148,159` (Zedon root) | the C1/C2 summary and the W7 note that `plugins/builtin.ts` and `plugins/danyapi/mcp.js` are two unreconciled copies |

### 2.3 Names that must stay, and why

These are load-bearing outside the renamed repository. Renaming any of them breaks a thing that is already
on disk or already on the wire.

1. **The OpenAI-compatible route strings.** `/v1/chat/completions`, `/v1/models`, `/v1/models/{model_id}`,
   `/health`. They are the whole reason the project exists, they are what any OpenAI client speaks, and
   Conclave probes `/v1/models` (`compose.ts:4-5`, `supervisor.ts:197`). A rename that touches these is a
   rewrite, not a rebrand.
2. **The compose service name `danyapi` and the published host port `8000`.** `composeContractError`
   hard-codes both as expectations (`compose.ts:69-70`) and refuses to write a compose file that drifts,
   and `buildRecipe.test.ts:25` asserts `{ service: 'danyapi', hostPort: 8000 }`. The *file* is
   Conclave-owned so it can be changed, but the change is a three-way edit: the vendored compose file, the
   `expectedService` default, and the test.
3. **The persisted SQLite setting keys.** `danyapi_port` (`db/index.ts:75`, `bootstrap/index.ts:176`),
   `danyapi_pinned_commit`, `danyapi_commit`, `danyapi_image` (`pin.ts:25-27`),
   `deepseek_endpoint`, `active_provider`, `deepseek_model` (`db/index.ts:70-73`). These are already written
   into `orchestrator/data/conclave.db` on any machine that has booted Conclave. Renaming them needs a
   migration or the old rows become invisible; the cheap and correct choice is to leave them.
4. **The plugin id `danyapi`.** It is the directory `<DATA_DIR>/plugins/danyapi/` and the prefix of every
   MCP tool name the UI shows: `TOOL_PREFIX = 'plugin_'` (`plugins/index.ts:56`) composed into
   `plugin_danyapi_ask_deepseek` (`mcp/index.ts:147`, `settings/+page.svelte:462,474`). A rename changes
   user-visible tool names and any saved reference to them.
5. **The container name `danyapi`.** The supervisor reads container state back out of
   `docker compose ps` JSON and the tests parse `ContainerName` (`buildRecipe.test.ts:76`).
6. **`DANYAPI_HOST` and `DANYAPI_PORT` as a pair.** Both sides write them, so they are renameable, but only
   together: the vendored Dockerfile (`Dockerfile:39-40`) and the bootstrap `.env` template
   (`bootstrap/index.ts:146-147`).
7. **The `LICENSE` copyright line.** MIT requires it to travel.

Not on the list, and worth saying explicitly: **`session_id` in the chat body is a DanyAPI-owned protocol
field and must stay**, but the `/sessions/<id>` route Conclave calls does not exist in either DanyAPI copy,
so that route is a bug to reconcile, not a string to preserve.

---

## 3. What the app's own structure suggests for extension

### 3.1 How a provider is added today

Ten steps, in the order the imports force. A new provider `foo` touches **eight existing files plus a new
package**:

1. **The package.** Create `danyapi/foo/` with `__init__.py`, `accounts.py`, `client.py`, `api.py`. Every
   existing provider follows this shape; `aihorde` is four files, `aistudio` five (it adds `browser.py` and
   `doh.py`), `opencode` five, `mistral` four.
2. **The account type.** A subclass of the pool's account, as `danyapi/mistral/accounts.py` does, with a
   `stable_id`.
3. **The registry tuple.** `danyapi/api/state.py:13` `BYOK_PROVIDERS` — add `"foo"`. This single tuple is
   the spine: `state.py:19` `MODEL_ATTRS` and `state.py:31` `POOL_ATTRS_BY_PROVIDER` must gain matching
   keys, and `api/models.py:45` `PROVIDER_NAMES = BYOK_PROVIDERS` inherits it.
4. **Key policy.** `state.py:15` `KEYLESS_PROVIDERS` if the provider needs no key, `state.py:17`
   `KEY_OPTIONAL_PROVIDERS` if the key is optional.
5. **The name list for the disable flag.** `danyapi/config.py:73` `PROVIDER_NAMES` is a **second, literal
   copy** of `BYOK_PROVIDERS`; miss it and `DANYAPI_DISABLED_PROVIDERS=foo` is logged as unknown and
   ignored (`config.py:257-260`).
6. **Credentials and settings.** A field in `Settings.__init__` (`config.py:213-250`) using one of the
   `_env_*` helpers, and the matching key in `.env.example` and `README.md`'s configuration table.
7. **Routing.** `danyapi/api/models.py:516` `_resolve_provider` — add a branch to the `if/elif` chain, which
   currently matches on `MODEL_PREFIX`, `startswith` families and `_known_ids(provider)` sets.
8. **Model discovery.** A `_fetch_foo_models(client)` function and an entry in `danyapi/api/models.py:303`
   `MODEL_FETCHERS`.
9. **The chat handler.** `danyapi/api/chats.py:39` `CHAT_HANDLERS` plus the `_chat_completions_foo`
   function, plus a `*_UNSUPPORTED_PARAMS` tuple if the provider rejects OpenAI fields
   (`chats.py:55-61` defines one per provider). `chats.py:890-893` `_validate_chat_handlers()` runs at import
   and raises `RuntimeError` naming any handler in `CHAT_HANDLERS` that is not a real global, which is the
   one guard that catches a half-done step 9.
10. **Startup wiring.** `danyapi/api/core.py:162-170` (the local account lists), `:200-234` (client
    construction, each one `if settings.provider_enabled("foo")`), `:243-252` (the `groups` tuple fed to
    `asyncio.gather`), `:264-271` (the per-provider auth slices), `:400-435` (the `AccountPool` assignment)
    and `:436-451` (the all-empty `RuntimeError`). Plus `danyapi/api/openai.py:20-40` needs the
    `from ..foo import api as foo_api` import for the route module to exist at all, and
    `api/openai.py:300-314` re-exports `BYOK_PROVIDERS`, `MODEL_ATTRS` and `POOL_ATTRS_BY_PROVIDER` so tests
    can reach them.

So: eight existing files, one new package of three to five files, plus tests. There is no registry object,
no decorator, no plugin hook. The honest reading is that this is a deliberate monolith with a hand-maintained
parallel list, and that adding a provider is safe only because `_validate_chat_handlers()` and
`audit_credential_env_names()` exist to catch two of the eight steps.

### 3.2 Where the design fights an extension

One line each, with the symbol:

- **Nine parallel hardcoded provider lists.** `state.py:13` `BYOK_PROVIDERS`, `state.py:15`
  `KEYLESS_PROVIDERS`, `state.py:17` `KEY_OPTIONAL_PROVIDERS`, `state.py:19` `MODEL_ATTRS`, `state.py:31`
  `POOL_ATTRS_BY_PROVIDER`, `config.py:73` `PROVIDER_NAMES`, `chats.py:39` `CHAT_HANDLERS`, `models.py:303`
  `MODEL_FETCHERS`, `core.py:243` `groups`. A single dict-of-descriptors is the obvious consolidation.
- **A growing string-matching router.** `models.py:516-537` `_resolve_provider` decides the provider from
  model-id prefixes plus literal id tuples (`ALICE_MODEL_IDS`, `_known_ids(...)`) plus an AI Horde list of
  fourteen hardcoded model names at `:532-536`. Two providers whose prefixes overlap cannot both be added
  without editing this chain.
- **One identity per provider, not per account.** `core.py:334` `AliceAccount(len(alice_accounts),
  alice_client, stable_id="alice")`, `core.py:340` `DuckAIAccount(..., stable_id="duckai")` and
  `core.py:348` `MistralChatAccount(..., stable_id="mistral")` give every account of a provider the same
  `stable_id`. Contrast `core.py:285` `stable_id=_token_stable_id(token)`, which is per-credential. The
  session/affinity keys therefore cannot distinguish two Le Chat logins.
- **A synchronous subprocess on the request path, and one that is already handled.** `pow.py:439`
  `await asyncio.to_thread(solver, ...)` and `attest.py:280`
  `await asyncio.to_thread(evaluate_sync, script, user_agent)` are correct. The remaining blocking work is
  `store.py:313` `loop.run_in_executor(_FLUSH_EXECUTOR, self._flush_background)` on a **single-worker**
  `ThreadPoolExecutor` (`store.py:29`), so every store commit in the process serialises behind one thread.
- **Two HTTP stacks side by side.** Eleven call sites build `httpx.AsyncClient` (`deepseek/client.py:76`,
  `qwen/client.py:116`, `aihorde/client.py:203`, `duckai/client.py:461`, `opencode/client.py:193`,
  `gigachat/client.py:114`) while `aistudio/client.py:161` builds a raw `httpcore.AsyncConnectionPool` and
  `aistudio/doh.py:138` opens a throwaway `httpx.AsyncClient` **inside** the DNS resolve path. Two of those
  are lazy properties with a setter (`opencode/client.py:187-204`, `gigachat/client.py:108-126`), which is
  the duplication showing through.
- **Global mutable state, four kinds.** Module-level dicts guarded by hand: `store.py:31-34`
  `_PATH_LOCKS`/`_LIVE_STORES`, `store.py:55` `_STATES`, `models.py:70` `_REFRESH_LOCKS`; and
  `chats.py:63` `_SESSION_OWNERS: OrderedDict[str, str]` plus `api/openai.py:326` `_root_ctx`, both
  process-global and never cleared on a config reload. Everything else lives on `app.state`
  (`state.py:69-97`), which is at least one object, but is read through `getattr(app.state, attr, None)`
  with a string key from `POOL_ATTRS_BY_PROVIDER`, so a typo is a silent `None`.
- **A config flag read by the launcher and not by the server.** `DANYAPI_AUTO_UPDATE` is in `config.py:243`
  and in `.env.example`, and its only consumer is `docs/start.py`'s `env_flag`. Reading `config.py` alone
  cannot tell you that, and the vendored image runs `python -m danyapi`, which never consults it.
- **A documented flag list that has already drifted.** `README.md:94` lists the
  `DANYAPI_DISABLED_PROVIDERS` names as `deepseek, qwen, gigachat, opencode, alice, duckai, mistral,
  aistudio` while `config.py:73` accepts `aihorde` too. Harmless today, but it is the same class of defect
  as the parallel lists above and a rebrand is the natural moment to generate one from the other.
- **Four legacy flags removed but still documented in the older copy.** `ref/README.md:107,109,111` and
  `ref/.env.example:6,8,30,31` describe `ALICE_ENABLED`, `DUCKAI_ENABLED`, `BYOK_MODE` and
  `DANYAPI_BYOK_MODE`; `prod` reads none of them and its `README.md` does not mention them. A migrated
  `ref/.env` would look correct and have no effect.

---

## 4. Container specifics

Three Dockerfiles and two compose files, with `ref`'s compose file standing in for the third because `prod`
has none.

| | **prod** | **ref** | **vendored** (Conclave) |
|---|---|---|---|
| Path | `.agent-resources/DanyAPI-prod/Dockerfile` | `.references/DanyAPI/Dockerfile` | `orchestrator/provider-build/Dockerfile` |
| Base image | `python:3.15.0rc2-slim-bookworm@sha256:1776b3fd…` | `python:3.14.2-slim-bookworm@sha256:e87711ef…` | `python:3.14-slim@sha256:a2b82f3c…` (manifest list, lines 14 and 8-13) |
| Debian base | bookworm | bookworm | **trixie-slim**, stated in the comment at line 12 |
| Non-root user | `groupadd --gid 10001 danyapi`, `useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin`, `chown -R 10001:10001 /app /tmp/danyapi`, `USER 10001:10001` | identical | **absent** — the image runs as root |
| Healthcheck | `HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3` curling `/health` with `urllib.request` | identical | **absent** |
| Exposed port | `EXPOSE 8000` | `EXPOSE 8000` | `EXPOSE 8000` (line 42) |
| Entrypoint / cmd | `CMD ["python", "-m", "danyapi"]` | same | same (line 44), no `ENTRYPOINT` |
| Toolchain purged | `apt-get purge -y gcc libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*` | same | same (lines 34-36) |
| Toolchain installed | `gcc libc6-dev nodejs` | `gcc libc6-dev nodejs` | `gcc libc6-dev nodejs **curl**` (line 32) |
| Solver build | `gcc -O3 -pthread -funroll-loops -flto -fomit-frame-pointer` | identical | identical (line 33) |
| `ENV` | `PYTHONUNBUFFERED=1`, `PYTHONDONTWRITEBYTECODE=1`, `DANYAPI_HOST=0.0.0.0`, `DANYAPI_PORT=8000` | `DANYAPI_HOST`, `DANYAPI_PORT` only | `PYTHONUNBUFFERED=1`, `DANYAPI_HOST`, `DANYAPI_PORT` (lines 38-40); **no `PYTHONDONTWRITEBYTECODE`** |
| Files copied | `danyapi`, `web`, `docs/{index.html,style.css,script.js,deepseek-logo.svg,qwen-logo.svg}` | identical | **`danyapi` only** (line 27) |
| Version constraints | none | none | `COPY constraints.txt` + `pip install -r requirements.txt -c constraints.txt` (lines 23-25) |
| `.dockerignore` beside it | present, 529 B | present, 395 B | **none in `provider-build/`** |
| Compose file | **none** | present, 382 B | present, 747 B |

The two compose files are field-for-field the same: service `danyapi`, `build: .`, `container_name: danyapi`,
`restart: unless-stopped`, `ports: ["8000:8000"]`, `env_file: ./.env`, and the single read-only volume
`/etc/localtime:/etc/localtime:ro`. `ref/docker-compose.yml:6` keeps a commented
`# image: ghcr.io/fanatfanata/danyapi:latest`; the vendored file drops it and adds nine lines of comment
naming the contract. Neither declares a volume for application state, which is the §1.5 finding.

### What the vendored copy lost

Five capabilities present in **both** local trees are absent from the vendored recipe, and each one is a
regression that reaches production behaviour rather than only the build:

1. **Non-root execution.** `USER 10001:10001` and the `groupadd`/`useradd` that precede it are gone, so the
   container Conclave builds and runs today executes as **root**. This is the most serious of the five.
2. **`HEALTHCHECK`.** Gone. The vendored compose file keeps `restart: unless-stopped`, so Docker can no
   longer tell a wedged server from a healthy one, and Conclave's own probe
   (`supervisor.ts` polling `http://127.0.0.1:8000/v1/models`, `compose.ts:4-5`) becomes the only liveness
   signal in the system.
3. **`COPY web ./web` and the five `docs/` assets.** Gone. The dashboard route
   `api/openai.py:357-362` falls through to `HTMLResponse("<h1>DanyAPI</h1><p>Web interface not found</p>",
   status_code=404)`, and `core.py:1150` `if docs_path.is_dir()` skips the `/docs` mount entirely, so the
   static site is not served either. The image is API-only by accident.
4. **`.dockerignore`.** Absent from `provider-build/`. This is the mildest of the five because
   `provider-build/` is not itself the build context: bootstrap writes those three files *into* the
   checkout (`pin.ts:96` `['constraints.txt', 'docker-compose.yml', 'Dockerfile']`, order deliberate per the
   comment at `pin.ts:88-90`) and `docker compose up -d` then runs with the checkout as context, so the
   checkout's own `.dockerignore` still applies. It is worth recording that `provider-build/` has no
   `.dockerignore` so a future change that builds from that directory does not silently ship `.env`.
5. **`PYTHONDONTWRITEBYTECODE=1`.** Gone, so `__pycache__` directories are created inside the image at
   runtime. Cosmetic next to the other four, but it is the kind of thing a rebuild-after-rebrand will
   normalise.

Two capabilities the vendored copy **gained**, which the rebrand should keep:

- **`constraints.txt`.** `provider-build/constraints.txt` pins the eight direct requirements and twelve
  transitive ones, read from the PyPI JSON API and `pip freeze` on 2026-10-15 per its own header
  (`constraints.txt:11-27`). Neither local tree has an equivalent. Note the file's own claim at
  `constraints.txt:3-6` that it describes "the checkout's `requirements.txt`" naming "seven packages with no
  version at all (`fastapi`, `uvicorn`, `httpx[socks]`, `pydantic`, `python-dotenv`, `pillow`,
  `python-multipart`)" — that is the **pinned fork checkout's** unpinned requirements, not `prod`'s floor-
  pinned file, so `prod`'s `requirements.txt` and this constraints file are two different policies and only
  one of them can be in the build context at a time.
- **`curl`** alongside `nodejs`, which makes the healthcheck available again whenever it is restored.

Two smaller notes with consequences for the rebrand:

- The vendored Dockerfile's base is a **floating tag plus a digest** (`python:3.14-slim@sha256:a2b82f3c…`)
  with a comment recording the manifest-list and per-platform digests and how they were resolved
  (`Dockerfile:8-13`). The digest wins over the tag, so the build is reproducible; but the tag is now a
  claim about a digest that may no longer be what `python:3.14-slim` resolves to, and the two local trees
  show the maintainer's own preference is the opposite (`3.15.0rc2` and `3.14.2`, exact versions, bookworm).
  Choosing one of the four base images is a rebrand decision, and choosing any of them means re-resolving the
  digest on the day.
- The local `.dockerignore` files also list `.DanyAPI.staging-*/` and `.DanyAPI.old-*/`, and `prod`
  additionally has the negation `!danyapi/gigachat/russian_trusted_root_ca.pem` (needed because it also
  excludes `*.pem`). Both patterns encode the package name, so they are in §2.1 row A5.

---

## Open questions this survey could not settle

- **Whether the newer revision deleted `docker-compose.yml`.** `prod` has none, `ref` and the pin's tree
  both have one. The upstream repository that would answer it is 404.
- **Which revision the two local copies correspond to.** Neither matches the pin's tree and no version
  string exists in either (`pyproject.toml` has no `[project]` table and there is no `__version__`). The
  ordering `pin < ref < prod` is argued from content, not from a recorded tag.
- **Image size.** Not measured here, and it should not be estimated from the Dockerfile: the vendored
  Dockerfile alone adds `curl` and removes nothing, while `prod` and `ref` differ in base image and cache
  behaviour. Measuring it needs `docker build` plus `docker image inspect`, or a registry read. Conclave's
  own `conclave-dependency-audit.md:265-266` records that `docker manifest inspect
  ghcr.io/mindflowgo/danyapi:latest` was readable while `ghcr.io/fanatfanata/danyapi:latest` answered
  `denied`, which is the right place to take that number from rather than re-deriving it.
- **Whether `ref/.env`'s empty template is what a real deployment looks like.** Every value in it is empty,
  so it records the key set and nothing about real credentials.
- **What `ref/danyapi`'s `DanyAPI_settings` file contains on a machine that has run Conclave.** The path is
  `<sandbox>/DanyAPI_settings` (`bootstrap/index.ts:135`) and it is git-ignored by Conclave, so it was not
  read here.

## What a rebrand checklist should contain, in order

1. Copy `prod` to the new repository as the base; do not start from the pin.
2. Decide the four strings before touching anything: the package directory name, the `DANYAPI_` env prefix,
   the `danyapi` compose service name, and the plugin id. Items 2 and 4 are cheap to keep.
3. Rename in this order: `danyapi/` and its 89 importing files, `"danyapi.api.openai:app"` in three places,
   `python -m danyapi` everywhere including the vendored Dockerfile, then the env prefix including Conclave's
   `.env` template and the vendored Dockerfile's two `ENV` lines.
4. Fix the vendored `Dockerfile` in the same change: restore `USER`, `HEALTHCHECK`, `web/` and `docs/` copies,
   and `PYTHONDONTWRITEBYTECODE`.
5. Add the missing `/sessions/{id}` and `/v1/files` routes, or delete Conclave's calls to them. Do not treat
   them as names to preserve.
6. Declare `httpcore` and `starlette`, and decide whether `python-multipart` stays as an implicit
   FastAPI extra or becomes explicit.
7. Leave the persisted SQLite keys, the OpenAI routes, `session_id`, and the `LICENSE` line alone.

## The decision, 2026-10-15

Taken by senpai after reading this page, and it **reorients** the plan rather than adding to it:

1. **ConclaveAPI runs as a native, supervised Python sidecar — not in a container.** Managed by `uv`
   (interpreter, virtualenv, lockfile) and spawned and supervised by the orchestrator the way the Bun
   sidecar already is. `crates/`'s loader and `orchestrator_loader.rs` are the precedent.
2. **The rebrand renames identifiers *and* prose across both trees in one pass**, keeping the MIT
   notice and a provenance paragraph naming FANATATFANATA — which is both the licence term and the
   honest history.
3. **No base image is chosen, because there is no longer an image.**

### What this retires

- **S1's image half** — the base-image digest, the vendored `Dockerfile` and `docker-compose.yml`, and
  the constraints-as-a-layer. The *source* pin survives in a new shape: pin the revision and the
  dependency set, and `uv.lock` with hashes is strictly stronger than `constraints.txt`.
- **C3** (the supervisor's container state) and **O3** (`service_state`) — there is no daemon to ask.
- **F7** (404 is not healthy) — no plugin binds the provider's port.
- **W4's second half** — two `docker compose up -d` on one boot. The *shape* recurs as two paths
  starting one process, so the in-flight guard stays; the compose file does not.
- The Docker Desktop requirement, which also removes the most common first-run failure on Windows.
- The `danyapi_image` and `danyapi_commit`-as-image settings, and the "Docker Active" badge D1's other
  half was bound to.

### What it keeps, in a new shape

- **The revision pin.** Still one revision, one verified `HEAD`, one recorded value — now the thing
  `uv.lock` and the source pin describe together.
- **The non-root, healthcheck and volume concerns.** They become "do not run as an administrator",
  "`/health` is polled and its answer is believed", and "state lives in a declared directory".
- **The supervision contract.** Spawn, log, poll health, restart with backoff, kill on exit — the
  properties `orchestrator_ws.rs` already gets right for the WebSocket side.

### What it creates

- **A Python runtime story.** `uv` manages the interpreter, so the question becomes how Conclave
  obtains or bundles it, and what happens on a machine that has neither `uv` nor Python.
- **A per-platform answer for the compiled solver.** There is no `gcc` on a stock Windows box, so
  either the C solver is built at install time, or the JavaScript fallback (`pow_solver.js` plus
  `sha3_wasm_bg.wasm`) becomes the default path and Node becomes a hard requirement — or the PoW is
  ported to Python with `hashlib.sha3` and the whole class disappears. **That choice is unmeasured and
  is the first thing to measure.**
- **`node` as a dependency regardless**, because `duckai/jsa_solver.js` evaluates JavaScript served by
  the remote host in a sandboxed subprocess and has no Python equivalent.

### The phase order this implies

1. **Adopt `prod`** as the tree, under the name ConclaveAPI, with the native runtime. (Nothing else
   should be built on the older revision.)
2. **Reconcile Conclave to the real route surface** — see the three findings in this page's §4 and the
   review's route table: there is no `/v1/sessions` and no `/v1/files`, so **C1 and C9 both need
   revisiting**, and attachments must be staged inline on the completion request.
3. **Wire the sidecar** — uv, supervision, logging, restart, teardown.
4. **Then Phase 4's one real end-to-end run**, which no longer needs Docker at all.
5. **Then the rename in one pass**, when the runtime works and the surface is settled — because a
   rename during a redirect renames things twice.