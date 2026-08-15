# PR #396 next-safe slice evidence

Status: scoped product port, disposable parity probes, full repository gate, and isolated standalone preview complete. The branch is not pushed and no installed-app acceptance is claimed.

## Provenance and scope

- Exact convergence base: `657dcaae82e07375f59bdabed93adb7141dd0a5c`.
- Local-agent source: PR #396 commit `257f018e17f074f40a424a507524cd7ae1bebc3f` (`refactor(settings): canonicalize local agent registry`).
- Engine-capability source: PR #396 commit `d56724f2f9330da2a58fd2532352d788a5d0d2d9` (`refactor(frontend): define visual capability catalogues`). Only `engine-capabilities.ts` was ported; the source commit's unrelated `themes-data.ts` change was excluded.
- Local-agent product commit: `c6271ab4c` (`refactor(settings): canonicalize local agent registry`).
- Engine-capability product commit: `b2f553bbd` (`refactor(recipes): consolidate engine capabilities`).
- Exact product paths: deletion of `frontend/src/features/settings/local-agent-detection.ts`; addition of `frontend/src/features/settings/local-agent-registry.ts`; updates to `frontend/src/features/settings/local-agents.ts` and `frontend/src/features/recipes/engine-capabilities.ts`.
- Canonical `@/lib/guards` was retained. The registry table is private to `local-agent-registry.ts`; the public `local-agents.ts` façade remains exactly `LOCAL_AGENT_IDS`, `attachModelToAgents`, and `detectLocalAgents` plus its existing type exports.
- The engine port uses an exhaustive boolean-key record, derives every boolean capability from it, preserves the four backend values, fallback, labels, option arrays, and tab arrays, and freezes both shared tab arrays at runtime.
- Repository policy requires comment-free touched code. Existing comments in the three retained touched source files were removed; no new source comments were added. The only `//`-shaped match is the existing OpenCode schema URL.
- No automated test file was added, restored, modified, or run.

## Runtime parity

Before the probe, the canonical files at `/Users/sero/projects/vllm-studio-v201` were proven byte-identical to their blobs at exact base `657dcaae8`; the probe therefore compared that immutable old implementation with product tip `b2f553bbd`.

The disposable probe exercised both implementations over separate generated homes and compared normalized results and complete file snapshots:

- detection order, labels, resolved paths, and `exists` values for pi, OpenCode, Droid, Hermes, and OMP;
- reverse-order attachment result ordering;
- existing JSON and YAML updates, new-file creation, unrelated-key preservation, merge actions, exact file modes, original-file backups, and OMP `enabledModels` backup/update;
- OpenCode matching-base-URL selection when the XDG candidate is malformed, XDG creation, and dot-directory creation;
- OMP YAML preference when both formats exist, JSON selection when only JSON exists, and YAML default for a new file;
- malformed JSON/YAML and missing-agent error results;
- façade export identity;
- every engine capability object for `undefined`, `vllm`, `sglang`, `llamacpp`, `mlx`, and an invalid fallback; every options kind across all seven tabs; all engine labels; and runtime tab immutability.

Results:

| proof | result |
|---|---|
| local-agent normalized parity | PASS, SHA-256 `f3679c6e86b347987ccbdc469ea5e6a6389e83915a2f0c1f0fa220037d8e756f` |
| façade exports | PASS, `LOCAL_AGENT_IDS,attachModelToAgents,detectLocalAgents` |
| complete engine JSON parity | PASS, SHA-256 `75e8b9b610f3be9b8aca9c5ca6588190b3b92d549d9c0858375d45489c86a7de` |
| frozen tabs | PASS for all six inputs |
| disposable runtime cleanup | PASS |

Persistent artifacts:

- `/Users/sero/projects/vllm-studio-v201-evidence/pr396-next-safe-20260815/parity-probe.ts`, SHA-256 `03c6d27784bfb8728fa474d0ec32b0fc77c485096b662aadb0fbbfd26d771b61`.
- `/Users/sero/projects/vllm-studio-v201-evidence/pr396-next-safe-20260815/parity-probe.log`, SHA-256 `f337d3c0fb455a15df4c530f08f3d59d9476a27494bc0687bab4b8d01370d5f7`.

## Validation

Both product commits passed the unbypassed pre-commit hook: staged ESLint fix, Prettier, and full frontend TypeScript checking. The first attempt at the local-agent commit reached TypeScript but lacked the fresh worktree's cross-package dependency trees; after attaching the exact canonical dependencies, the unchanged staged product passed and committed normally.

Root `npm run check` at exact product tip `b2f553bbd` passed all six top-level gates through the agent-runtime build. The final transcript is `/Users/sero/projects/vllm-studio-v201-evidence/pr396-next-safe-20260815/root-npm-check-r3.log`, SHA-256 `18ec6b4115087b259356012c315b8cf45f87f629dff5d625b2095be16428461b`, ending `NPM-CHECK-EXIT:0`.

Two unchanged-tip infrastructure attempts are retained rather than represented as product failures:

- `root-npm-check.log`, SHA-256 `486f6652a9c0d8217f52b16db577d2d3364abdd5b25bc7942def5b186cf1ed1c`, reached the frontend build and ended `NPM-CHECK-EXIT:1` because Bun was absent from the executor `PATH`.
- `root-npm-check-r2.log`, SHA-256 `d4075068ffedf82c0c4d0f11367064c299d8874e28b21f8cb645945f7a8c05f4`, compiled and statically generated the frontend, then ended `NPM-CHECK-EXIT:1` because dependency symlinks made the standalone `typebox` copy source and destination resolve to the same path.
- R3 prepended `/Users/sero/.bun/bin` to `PATH` and replaced only lane-generated dependency symlinks with APFS clone directories. No product file changed between R1, R2, and R3.

## LOC ledger

Frozen cloc 2.06 production pipeline, same 792-file scope:

| ref | blank | comment | code |
|---|---:|---:|---:|
| base `657dcaae8` | 8,367 | 4,152 | 104,557 |
| product `b2f553bbd` | 8,359 | 4,119 | 104,498 |
| delta | -8 | -33 | **-59** |

The raw four-file product diff is +184/−284 lines; the frozen production-code reduction is 59 lines. This slice improves the row 1.1 ledger but does not complete the ≤80,667 target.

## Isolated standalone preview and remaining boundary

The checked standalone build ran on `127.0.0.1:13960` with `HOME` and `LOCAL_STUDIO_DATA_DIR` under the persistent evidence directory. `GET /api/local-agents` returned HTTP 200 with all five agents in canonical order, paths rooted only in the disposable home, and `exists=false`; `GET /settings` returned HTTP 200, 145,044 bytes, title `Local Studio`, SHA-256 `340c8a1e59da9db30d3149ae996f0921c12e0e88e2e71025030e96604e69d90a`. The server was stopped, port 13960 was closed, and the preview home, data, and HTML capture were removed.

This is source, full-build, runtime-parity, and isolated standalone HTTP evidence. It is not a browser interaction, installed desktop build, or controller-backed POST attachment acceptance. Those broader release surfaces remain with the parent convergence lane.
