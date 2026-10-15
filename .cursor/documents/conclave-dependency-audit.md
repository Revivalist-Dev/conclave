---
title: Conclave dependency audit — 25 declared, 17 current, 8 behind
topic: conclave-dependency-audit
updated: 2026-10-15
status: current
---

# Conclave dependency audit — 25 declared, 17 current, 8 behind

Every dependency this project declares at commit `1dd4aec`, measured against npm, crates.io and the
container registries on **2026-10-15**. The upgrade this audit recommends then landed on `main` as
`d4f3235` (*Upgrade every dependency to its latest published version*, 2026-10-15), recorded separately
below so the measured state and the upgraded state are not conflated. What the project is, and what a
rename of it touches, is [the companion page](./conclave.md).

## Headline counts

| Measure | Count |
|---|---|
| **Declared dependencies** | **25** — across 5 manifests (`client/web/package.json` 15, `client/tauri/src-tauri/Cargo.toml` 9, `client/tauri/package.json` 1, root and `orchestrator` 0 each) |
| **Current** (the declared range already admits the latest) | **17** |
| **Behind** (the range's ceiling is below the latest) | **8** |
| …of which **major** | **8** — 7 npm and 1 Rust. **Zero** patch and **zero** minor. |
| **Deprecated** | **1** — `lucide-svelte`, which npm flags "Please use `@lucide/svelte` instead" |
| **Yanked** | **0** (checked per crate on crates.io) |
| **Archived upstream repos** | **0** — but **3 repositories have relocated**, which is the sharper signal (see below) |
| **Toolchain pins declared** | **0** — no `engines`, no `packageManager`, no `rust-version`, no `rust-toolchain.toml`, no `.nvmrc` |

The eight behind are, in both npm and Cargo: `@sveltejs/kit` 2→3, `vite` 6→8, `@sveltejs/vite-plugin-svelte`
4→7, `@sveltejs/adapter-auto` 3→8, `@sveltejs/adapter-static` 3→4, `typescript` 5→6, `lucide-svelte`
0.475→1.0, and `tokio-tungstenite` 0.24→0.30. Every one is a breaking jump, and none is avoidable by
staying inside the declared range.

## How "gap" is classified

**Gap** is the semver distance from the highest version the declared range admits to the latest published
version. `none` means the range already admits the latest, so nothing needs doing — the number may still be
several releases behind the floor, which is why the declared range is shown beside it. `patch` / `minor` /
`major` mean the latest sits above the range's ceiling by that step, so a manifest edit is required, and a
step past the ceiling in `minor` or `major` position is a breaking bump. For a `0.x` version the `minor`
position is the breaking one, which is how `tokio-tungstenite` is read.

Nothing here was taken from a package's marketing; every "latest" is a live registry read, and the queries
are recorded in the method note at the foot of the page.

## npm — [`client/web/package.json`](../../client/web/package.json)

15 dependencies: 13 `devDependencies` (lines 13–25) and 2 `dependencies` (lines 28–29).

| Dependency | Line | Declared | Latest | Gap | Breaking? |
|---|---|---|---|---|---|
| `@sveltejs/adapter-auto` | 13 | `^3.3.1` | 8.0.0 | **major** | yes — SvelteKit 3 line |
| `@sveltejs/adapter-static` | 14 | `^3.0.10` | 4.0.0 | **major** | yes |
| `@sveltejs/kit` | 15 | `^2.16.0` | 3.1.0 | **major** | yes — the framework itself |
| `@sveltejs/vite-plugin-svelte` | 16 | `^4.0.0` | 7.3.1 | **major** | yes |
| `@tailwindcss/vite` | 17 | `^4.0.0` | 4.3.3 | none | no |
| `clsx` | 18 | `^2.1.1` | 2.1.1 | none | no |
| `lucide-svelte` | 19 | `^0.475.0` | 1.0.1 | **major** | yes, **and deprecated** — see below |
| `svelte` | 20 | `^5.0.0` | 5.57.2 | none | no |
| `svelte-check` | 21 | `^4.1.4` | 4.7.6 | none | no |
| `tailwind-merge` | 22 | `^3.0.1` | 3.7.0 | none | no |
| `tailwindcss` | 23 | `^4.0.0` | 4.3.3 | none | no |
| `typescript` | 24 | `^5.7.0` | 6.0.3 — **7.0.2 is published but capped**, see the correction below | **major** | yes, one major, not two |
| `vite` | 25 | `^6.0.0` | 8.3.4 | **major** | yes — two majors at once |
| `highlight.js` | 28 | `^11.12.0` | 11.12.0 | none | no |
| `marked` | 29 | `^18.0.12` | 18.1.1 | none | no |

Six of the fifteen are behind, and every one of the six is major. The one 2-major jump
(`vite` 6→8) is the most likely to need source-adjacent changes rather than a version edit, and
`typescript` carries a ceiling of its own — see the correction below.
Note that `@tailwindcss/vite` and `tailwindcss` resolve to the same latest (4.3.3) and must move together,
since the plugin is versioned with the engine.

> **Correction, 2026-10-15 — `typescript` is capped at 6, and this page first said 7.**
> The table above named `7.0.2` as the target because that is the latest *published* version, and the
> bump was attempted on that basis. It breaks the build. TypeScript 7 is the native port and its npm
> package exports only `version` and `versionMajorMinor` — no `readConfigFile`, no `ts.sys` — while
> SvelteKit 3 calls `ts.sys.readFile`, so the build dies with
> `Cannot read properties of undefined (reading 'readFile')` and `svelte-check` cannot run at all. The
> peers agree: `@sveltejs/kit@3.1.0` declares `typescript: ^6.0.0` and `svelte-check@4.7.6` declares
> `^5.0.0 || ^6.0.0`, so **`^6.0.3` is the correct ceiling** and `^7.0.2` sits outside both peers'
> ranges. Verified against the published peer metadata, not from memory.
> **The general lesson:** "latest published" and "latest this project can use" are different numbers, and
> a peer-dependency range is what decides between them. Check `npm view <pkg>@<version> peerDependencies`
> before writing a ceiling into a document that someone will act on.

## npm — [`client/tauri/package.json`](../../client/tauri/package.json)

| Dependency | Line | Declared | Latest | Gap | Breaking? |
|---|---|---|---|---|---|
| `@tauri-apps/cli` | 13 | `^2.0.0` | 2.12.3 | none | no |

Current. The tracked lockfile is a minor behind on its own resolution (see Lockfiles, below).

## Cargo — [`client/tauri/src-tauri/Cargo.toml`](../../client/tauri/src-tauri/Cargo.toml)

8 dependencies across three blocks: `[build-dependencies]` (line 15), `[dependencies]` (18–20) and the
`cfg(unix)` block (26), with the two WebSocket crates at the foot (29–31). A platform-gated `objc2`
dependency, declared in its own table, has since been removed with the platform scrub.

| Crate | Line | Declared | Latest stable | Gap | Breaking? |
|---|---|---|---|---|---|
| `tauri-build` | 15 | `2` | 2.7.3 | none | no |
| `tauri` | 18 | `2` | 2.12.4 | none | no |
| `serde` | 19 | `1` | 1.0.229 | none | no |
| `serde_json` | 20 | `1` | 1.0.154 | none | no |
| `objc2` | 23 | `0.6` | 0.6.5 | none | no |
| `libc` | 26 | `0.2` | 0.2.190 | none | no |
| `tokio` | 29 | `1` | 1.53.3 | none | no |
| `tokio-tungstenite` | 30 | `0.24` | 0.30.0 | **major** | yes — see below |
| `futures-util` | 31 | `0.3` | 0.3.34 | none | no |

`tokio-tungstenite` is the only Rust dependency behind, and in `0.x` the minor position is the breaking one:
`0.24` admits `>=0.24.0 <0.25.0`, so 0.30.0 is six breaking minors away. It is the crate the whole
orchestrator WebSocket transport in `orchestrator_ws.rs` rests on, so the bump is not mechanical.

`tauri` and `tauri-build` both have a `3.0.0-alpha` line published (3.0.0-alpha.5 and 3.0.0-alpha.4). Both
are prereleases, both are *not* counted as a gap, and the `2` line is the stable one — recorded here only so
a reader who sees "3" on crates.io does not mistake it for a missed major.

> **Fixed 2026-10-15 — three dependencies were in the wrong table, and it broke Windows.**
> `tokio`, `tokio-tungstenite` and `futures-util` sat under `[target."cfg(unix)".dependencies]`, while
> `src/orchestrator_ws.rs` uses all three with **no `cfg` gate** and `src/lib.rs:7` includes that module
> unconditionally. So the Tauri client could not link on Windows at all — a pre-existing defect that
> predates every bump on this page. The three lines moved to `[dependencies]`; `libc` stays unix-only. `objc2` was macOS-only and **is gone** —
the whole `[target."cfg(target_os = "macos")".dependencies]` table was removed on 2026-10-15, along with
the `macos-private-api` Tauri feature and the `macOSPrivateApi` config key, because this product is never
built or shipped for macOS. Verified from `cargo metadata`: the three now report
`target=(none - all platforms)`. Committed as `d86170e`.
> **A correction, same day.** This page used to read "`libc` stays unix-only and `objc2` stays
> macOS-only", which was true when it was written and is not now. A dependency that is correctly *gated*
> can still be the wrong dependency to declare at all, and gating was the wrong question to stop at once
> the target set was decided.
> **What this teaches about reading this page:** the gap table above asks "is this dependency current",
> which is a different question from "is it declared in the right place". A dependency can be perfectly
> up to date and still not link on the platform you are building for, and only compiling on that platform
> finds it — `cargo metadata` shows the target gating, and it is one command.

## Manifests with nothing declared

Two of the five manifests declare no dependencies at all, and in the orchestrator's case that is a real
property rather than an oversight:

- [`package.json`](../../package.json) — the workspace root, scripts only.
- [`orchestrator/package.json`](../../orchestrator/package.json) — both
  blocks are explicitly empty (`"dependencies": {}` at line 8, `"devDependencies": {}` at line 9).
  Verified: the only non-relative module specifiers anywhere under `orchestrator/` are `bun:sqlite` and the
  Node built-ins (`child_process`, `fs`, `path`, `node:readline`, `node:url`). The backend therefore has no
  npm dependency tree to audit — and, because it relies on `bun:sqlite` and `Bun.serve`, it cannot be run
  under plain Node. That makes **Bun a hidden hard dependency with no declared floor** (see Toolchain).

## Deprecations, relocations, archivings

**Deprecated — one.** `lucide-svelte` (declared at `client/web/package.json:19`) is flagged by npm in
favour of `@lucide/svelte`. The successor is not a version bump inside the old package: `lucide-svelte`'s
final release is **1.0.1**, while `@lucide/svelte` is at **1.57.0** and carries its own version line. The
migration changes the import specifier as well as the version, so it is a code edit in every component that
imports an icon.

**Relocated — three repositories, and this is the more useful signal than "archived".** None of the three is
archived; all three have moved, which breaks a reader who follows the old URL:

| Dependency | Old home | Now |
|---|---|---|
| `@sveltejs/adapter-auto` | `sveltejs/adapter-auto` — **404** | the `sveltejs/kit` monorepo, `packages/adapter-auto`; npm's `repository.url` is `git+https://github.com/sveltejs/kit.git` |
| `@sveltejs/adapter-static` | `sveltejs/adapter-static` — **404** | the `sveltejs/kit` monorepo, `packages/adapter-static` |
| `tokio-tungstenite` | `tokio-rs/tungstenite` — **404** | `snapview/tokio-tungstenite`, confirmed by the crate's own `repository` field on crates.io |

The two adapters were folded into `sveltejs/kit` — which is also why their majors moved to 8 and 4 while the
Kit framework moved to 3: they are now released from the same monorepo.

**Archived — none.** All 18 upstream repositories behind the npm and Cargo dependencies were queried for the
`archived` flag and every one returned `false` (or had relocated, above). One has been quiet rather than
archived: `lukeed/clsx` was last pushed 2024-06-10, which is expected for a two-function utility at 2.1.1 —
it is complete, not abandoned.

**Yanked — none.** Every crate in `Cargo.toml` reports `yanked: false` and an `updated_at` inside the last
two weeks, with the single exception of `tokio-tungstenite`, last released 2026-07-11.

## Toolchain pins — there are none, and that is the finding

**Verified: the tree declares no toolchain pin of any kind.** No `engines` or `packageManager` field in any
of the four `package.json`; no `volta` block; no `rust-version` key in `Cargo.toml`; and no
`rust-toolchain.toml`, `.nvmrc`, `.node-version`, `.python-version` or `.tool-versions` anywhere in the
tree. The only version string in the whole repository is the `bun init` scaffold line at
`client/web/README.md:15`, which records the bun that generated the web package.

Measured against the machine this project is developed on:

| Tool | Machine | Declared floor | Note |
|---|---|---|---|
| bun | **1.3.14** | none | matches `client/web/README.md:15` exactly, but nothing enforces it |
| Node | **v24.19.0** | none | the MCP stdio bridge is `#!/usr/bin/env node` |
| cargo / rustc | **1.91.0** (stable-x86_64-pc-windows-msvc) | none | and the build has a *runtime* use for it |

The Rust requirement is not optional and not declared:
[`scripts/build-sidecar.ts:22`](../../scripts/build-sidecar.ts) shells out to
`rustc -Vv` to discover the host triple and **throws** if it cannot (`:28`), falling back only to an
`SIDECAR_TRIPLE` environment variable (`:33`). So the build silently depends on a `rustc` on `PATH` whose
version must also satisfy Tauri's own MSRV in `Cargo.lock` — with no pin stating either.

## Lockfiles

Four lockfiles are tracked, all unmodified by the rename:

| Lockfile | Format | Root declaration | Note |
|---|---|---|---|
| [`client/web/bun.lock`](../../client/web/bun.lock) | `lockfileVersion: 1`, 37 KB | the same 13 + 2 as `package.json` | at `1dd4aec` this agrees with `package.json` exactly |
| [`client/web/package-lock.json`](../../client/web/package-lock.json) | `lockfileVersion: 3`, 64 KB | the same 13 devDeps — `lucide-svelte` included — + 2 deps | npm's lockfile for a bun project: a **duplicate-resolution smell** |
| [`client/tauri/package-lock.json`](../../client/tauri/package-lock.json) | `lockfileVersion: 3`, 7.7 KB | `@tauri-apps/cli` | resolves `@tauri-apps/cli` to **2.11.4**, one minor behind the 2.12.3 latest |
| [`client/tauri/src-tauri/Cargo.lock`](../../client/tauri/src-tauri/Cargo.lock) | Cargo | 118 KB | not touched by the rename |

Two consumers (bun and npm) are tracked for the same package, and they can disagree: `bun install` and
`npm install` would resolve `client/web` independently, and only `bun.lock` is what the root scripts use.

## The recommended upgrade has since landed

The tables above measure `1dd4aec`. The upgrade they recommend was uncommitted in the working tree while
this audit was being written, and it was committed as **`d4f3235`** (*Upgrade every dependency to its
latest published version*, 2026-10-15 10:13). `main` and `origin/main` then moved on to **`d86170e`** four
minutes later, the Cargo table fix recorded in the Cargo section above:

- `client/web/package.json` — 13 dependency lines changed: `@sveltejs/adapter-auto` → `^8.0.0`, `adapter-static` →
  `^4.0.0`, `kit` → `^3.1.0`, `vite-plugin-svelte` → `^7.3.1`, `@tailwindcss/vite` → `^4.3.3`,
  **`lucide-svelte` replaced by `@lucide/svelte: ^1.57.0`**, `svelte` → `^5.57.2`, `svelte-check` →
  `^4.7.6`, `tailwind-merge` → `^3.7.0`, `tailwindcss` → `^4.3.3`, `typescript` → `^6.0.3`, `vite` →
  `^8.3.4`, `marked` → `^18.1.1`;
- `client/tauri/package.json` — `@tauri-apps/cli` → `^2.12.3`;
- `client/tauri/src-tauri/Cargo.toml` — `tokio-tungstenite` → `0.30`;
- `client/web/bun.lock` — 236 lines changed (92 added, 144 removed), re-resolved to match;
- thirteen front-end files — eleven under `client/web/src/`, plus `tsconfig.json` and `vite.config.ts` —
  which is the code half of the Vite 6→8 move; nine of them are the `lucide-svelte` → `@lucide/svelte`
  import rename.

`client/web/node_modules/` exists, so the upgrade has been installed. Under that working tree the counts are
**25 declared, 25 current, 0 behind, 0 deprecated** — every gap on this page is closed already, and only the
commit is outstanding. `@lucide/svelte`'s latest is 1.57.0, exactly the range the working tree declares.

## Comparison with the audit this page replaces

A prior reading of the same tree recorded **34 declared, 27 current, 7 behind, all 7 major**, with
`lucide-svelte` deprecated. Re-measured:

- **The deprecation reproduces exactly.** `lucide-svelte` is still flagged, and the successor is
  `@lucide/svelte`.
- **All seven of the prior page's behind-packages reproduce, with the same from→to pairs** — `@sveltejs/kit`
  2→3, `vite` 6→8, `@sveltejs/vite-plugin-svelte` 4→7, `adapter-auto` 3→8, `adapter-static` 3→4,
  `typescript` 5→6, `tokio-tungstenite` 0.24→0.30.
- **The totals do not reproduce, in two places.** Measured here it is **25 / 17 / 8**, not 34 / 27 / 7.
  - The behind count is **8, not 7**: the prior page's own deprecation note named `lucide-svelte`, but its
    behind-list omitted it — and `^0.475.0` against 1.0.1 is a major jump, so it belongs in both lists.
  - The declared count is **25, not 34**, on the reading used here: one row per dependency declared in the
    five manifests, ignoring lockfiles and transitive entries (15 npm in `client/web`, 1 in `client/tauri`,
    9 Cargo, and two empty manifests). I could not reach 34 from any reading of the committed tree. The
    arithmetic that fits is a doubled Cargo block — 25 + 9 = 34, and 9 is exactly the Rust count — but that
    is a **hypothesis, not a finding**, and it is recorded as unresolved.

## Method and queries

npm: `npm view <pkg> version` and `npm view <pkg> deprecated`, batched for all 16 npm packages.
crates.io: `Invoke-RestMethod https://crates.io/api/v1/crates/<crate>`, read from `max_stable_version`
(not `newest_version`, which is why the `tauri` 3.0.0-alpha line is excluded), plus `yanked` and
`updated_at`. Relocation and archiving: `gh api repos/<owner>/<repo>` for the `archived` flag and for the
404 that revealed each move, and the npm `repository.url` / crates.io `repository` field for where each one
went. Images: `docker manifest inspect ghcr.io/mindflowgo/danyapi:latest` (public, OCI index) and
`ghcr.io/fanatfanata/danyapi:latest` (`denied`). Toolchain: `bun --version`, `node --version`,
`cargo --version`, `rustc --version`.

Nothing was verified by building: no `bun install`, no `cargo build` and no `bun run build` were run against
this checkout, so every "breaking" verdict here is a semver-major reading, not an observed compile failure.

## Related

- [Project documentation map](./index.md) — the map this page hangs from
- [Conclave — provenance, layout, and the rename footprint](./conclave.md) — what the project is, the
  rename footprint, and the DanyAPI coupling this page's `ghcr.io` reads bear on
- [The reference-first rule](../../../../.cursor/rules/25-reference-first.mdc) — why the shelf, not a
  fresh implementation, is the first place to look before modernising anything here
