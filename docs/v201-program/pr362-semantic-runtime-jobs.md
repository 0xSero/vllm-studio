# PR 362 semantic runtime-job evidence

## Provenance

- Date: 2026-08-15
- Worktree: `/Users/sero/projects/vllm-studio-v201-pr362-semantic-jobs`
- Branch: `codex/v201-pr362-semantic-jobs-20260815`
- Base: `68559e4d899326d2c57b437b1a4780ce7471deee`
- Product commit: `f5af3284b741ea8293974c5079901bd7530b668f`
- External source: PR 362 head `9debc4de82e5518486847769348a4a65a3c11a4f`
- Product author preserved: `fettpl <38704082+fettpl@users.noreply.github.com>`, author date `2026-08-06T18:34:32Z`

The four production files at the product commit are byte-identical to the audited PR head. The production patch SHA-256 is `27af813d10c157df976caa0aa2f4f009150308b0695be9fff8c05872614358f6`.

## Scope

| File                                                     | Additions | Deletions |
| -------------------------------------------------------- | --------: | --------: |
| `controller/contracts/system.ts`                         |         5 |         1 |
| `controller/src/modules/engines/runtime-routes.ts`       |         1 |         1 |
| `controller/src/modules/engines/runtimes/engine-jobs.ts` |        31 |         8 |
| `frontend/src/lib/api/studio.ts`                         |         2 |         1 |

Total production scope is four files, 39 additions, and 11 deletions. No automated test file or test code was added or run.

## Static gates

- Controller TypeScript typecheck: pass.
- Frontend full TypeScript typecheck: pass.
- Focused frontend TypeScript check for `frontend/src/lib/api/studio.ts`: pass.
- ESLint on all four production files: pass.
- Shared-contract ownership validator: pass.
- `git diff --check`: pass.
- Exact four-file comparison with PR head: pass.
- Normal product commit hooks: pass, including staged frontend lint/format, frontend typecheck, and controller typecheck.

The first frontend typecheck attempt ran before the isolated worktree had read-only dependency links for `services/agent-runtime` and `shared`; it failed with missing dependency resolution and cascading unrelated type errors. After linking the existing dependency trees, the unchanged source passed the full frontend typecheck. The repository aggregate `npm run check` was not started because its serialized build slot was not granted.

## Disposable live request and dispatch probe

The probe ran an isolated controller on loopback port 60006 with a temporary data directory, temporary SQLite database, metrics disabled, no API key, and harmless CUDA and SGLang sentinel commands. The controller was stopped normally and the port was confirmed closed afterward.

| Scenario                                                                  | Result                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Baseline job registry                                                     | HTTP 200, zero jobs                                                             |
| `download` and `inspect` for vLLM, SGLang, llama.cpp, MLX, CUDA, and ROCm | All 12 requests returned HTTP 400; no jobs or sentinel calls were added         |
| Missing backend                                                           | HTTP 400, `backend is required`                                                 |
| CUDA `install`                                                            | Terminal error `CUDA supports update jobs only.`; CUDA sentinel remained absent |
| CUDA explicit `update`                                                    | Terminal success; CUDA sentinel invoked once                                    |
| CUDA request with omitted type                                            | Returned `type: update`; terminal success; sentinel invoked once                |
| CUDA upgrade route with body type `install`                               | Returned `type: update`; terminal success; sentinel invoked once                |
| CUDA upgrade route with body type `inspect`                               | HTTP 400; sentinel count unchanged                                              |
| SGLang `install`                                                          | Terminal success; SGLang sentinel invoked once                                  |
| SGLang `update`                                                           | Terminal success; SGLang sentinel invoked once                                  |

Final sentinel evidence was three CUDA invocations and two SGLang invocations. Their SHA-256 values were `a4b2f36a78854a25ecf3b5096a296f0a4c368289aa3b7c4bc2bba0f338d2a7b2` and `11b868c18de42c689e91880e1ed3a39721385eb83495bdba522adabf75262b10` respectively.

## Residual gap and cleanup

Platform install jobs still use the pre-existing public `vllm` backend representation and initially record a configured platform upgrade command before terminating with the unsupported-install error. The probe proved that the configured command is not executed, but the presentation remains a follow-up P2.

No production build, aggregate gate, installed-app run, push, or remote CI was performed. The disposable controller, temporary database, logs, sentinel scripts, sentinel output, focused TypeScript configuration, and temporary dependency links were removed after capture. No credentials, private data, or unrelated application state were captured.
