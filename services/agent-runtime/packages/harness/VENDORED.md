# Vendored: @earendil-works/pi-agent-core

| | |
|---|---|
| Upstream repository | https://github.com/earendil-works/pi.git |
| Package path | `packages/agent` (published as `@earendil-works/pi-agent-core`) |
| Version | 0.84.3 |
| Commit | `bfb004d4418ff05c6f909eaaab856cbe75c1fde0` |
| Vendored on | 2026-09-03 |
| License | MIT, © 2025 Mario Zechner — see `LICENSE` (upstream text, verbatim) |

`src/` is a verbatim copy of upstream `packages/agent/src` at that commit. This
package is consumed as the Bun workspace `@local-studio/harness` from
`services/agent-runtime`; nothing else in the repository may import it.

## Rule: no upstream tracking

This directory does not track upstream. There is no sync script and no
automatic update. Upstream changes land here only as hand cherry-picks, each
reviewed and recorded below with the upstream commit it came from. Bumping the
version table above without a full re-copy and a fresh review is not allowed.

## Dependencies

`package.json` pins exactly what upstream declares at 0.84.3: `@earendil-works/pi-ai`,
`diff`, `ignore`, `typebox`, `yaml`, and `@earendil-works/pi-telemetry`.

`pi-telemetry` was kept as a dependency rather than replaced by a local no-op:
`src/index.ts` and `src/harness/telemetry.ts` re-export ~30 types and four
runtime symbols (`createTypedSpanStarter`, `defineTelemetrySchema`,
`InMemoryTelemetryContext`, `NOOP_TELEMETRY_CONTEXT`) from it, the package has
no dependencies of its own, and it is already installed transitively by
`@earendil-works/pi-ai`. A shim would have been a larger diff than the import.

## Local modifications

### `src/`

None. Byte-identical to upstream.

### `test/` (ported from vitest to `bun:test`)

Kept (the tests that protect the behaviour the fork relies on — agent loop,
harness scaffold, session tree and JSONL repository, compaction, tools):

- `test/agent-loop.test.ts`
- `test/harness/agent-harness-scaffold.test.ts`
- `test/harness/compaction.test.ts`, `test/harness/branch-summarization.test.ts`
- `test/harness/reducer.test.ts`
- `test/harness/tools.test.ts`
- `test/harness/session/{context,jsonl,jsonl-codec,jsonl-storage,memory,search}.test.ts`
- `test/harness/session-test-utils.ts` (helper)

Changes applied to every kept file: `from "vitest"` → `from "bun:test"`.
File-specific changes:

- `test/harness/branch-summarization.test.ts`, `test/harness/session/context.test.ts`:
  `import type { AgentMessage } from "@earendil-works/pi-agent-core"` →
  the relative `src/index.ts`, so the tests type against the vendored copy and
  not the npm package that `pi-coding-agent` still pulls in.
- `test/harness/session/jsonl.test.ts`: `vi.useFakeTimers({ toFake: ["Date"] })`
  + `vi.setSystemTime(...)` / `vi.useRealTimers()` → Bun's `setSystemTime(...)`
  / `setSystemTime()` (Bun's `vi` has no `setSystemTime`).

Dropped: `e2e.test.ts` (real model), `agent.test.ts`, `proxy.test.ts`
(`vi.stubGlobal`), `telemetry.test.ts` (`expectTypeOf`), and the
`events`, `nodejs-env`, `prompt-templates`, `resource-formatting`, `skills`,
`system-prompt`, `truncate` harness suites — upstream unit coverage of code
the fork does not customise. Upstream `docs/`, `README.md`, `CHANGELOG.md`,
`scripts/` and the vitest configs were not copied.

### Added files (not upstream)

`package.json` (workspace manifest), `tsconfig.json` (editor-only; extends the
agent-runtime config with `target: ES2022` because
`src/harness/session/testing/conformance.ts` uses BigInt literals), this file.

### Consumer-side changes made for the vendored code

- `services/agent-runtime/tsconfig.json`: `allowImportingTsExtensions`;
  `tsconfig.build.json`: `rewriteRelativeImportExtensions` — upstream imports
  carry `.ts` extensions. `tsc -p tsconfig.build.json` type-checks the vendored
  sources but does not emit them (they resolve through `node_modules`); the
  runtime artifact is `dist/standalone.mjs`, which bundles them.
- `services/agent-runtime/bunfig.toml`: `linker = "hoisted"` — Bun's default
  isolated layout for workspaces would move `@earendil-works/*` out of the flat
  `node_modules` tree that `bundle-agent-runtime` and the tsconfig `paths` rely on.

## Cherry-pick log

None yet.
