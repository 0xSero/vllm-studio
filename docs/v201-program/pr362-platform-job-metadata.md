# PR 362 platform job metadata repair

## Provenance

- Date: 2026-08-15 EDT
- Worktree: `/Users/sero/projects/vllm-studio-v201-pr362-p2`
- Branch: `codex/v201-pr362-p2-20260815`
- Base: `370b7aa29175b904fb81537f98748de1c8b03858`
- Product commit: `9018edf38d1330b17dc6dc0444657eae2d69f210`
- External source: PR 362 head `9debc4de82e5518486847769348a4a65a3c11a4f`
- External co-author: `fettpl <38704082+fettpl@users.noreply.github.com>`
- Persistent evidence: `/Users/sero/projects/vllm-studio-v201-evidence/pr362-p2-20260815`

This is the bounded presentation repair required by the prior PR 362 evidence. Independent exact-commit review returned GO: the shared backend contract is canonical, unsupported platform installs omit the fictional command, and platform update and managed-engine execution paths remain unchanged. The branch is unpushed and has no hosted CI, installed-app, or release proof.

## Product scope

| File                                                     | Additions | Deletions |
| -------------------------------------------------------- | --------: | --------: |
| `controller/contracts/system.ts`                         |         5 |         1 |
| `controller/src/modules/engines/runtime-routes.ts`       |        17 |        12 |
| `controller/src/modules/engines/runtimes/engine-jobs.ts` |        10 |         7 |
| `frontend/src/lib/api/studio.ts`                         |         2 |         2 |

The product patch is four files, 34 additions, and 22 deletions. Formatter normalization accounts for the adjacent route-callback layout change. No automated test code or product-source comments were added or run.

- `RUNTIME_JOB_BACKENDS` and `RuntimeJobBackend` now live in the shared system contract beside `RUNTIME_JOB_TYPES` and `RuntimeJobType`.
- `EngineJob.backend` now preserves `cuda` and `rocm` instead of presenting platform jobs as `vllm`.
- Controller request validation and frontend request typing consume the shared backend and action contracts.
- Unsupported CUDA and ROCm install jobs return the existing explicit error without ever acquiring a `command` property.
- Platform updates, omitted-type defaults, forced upgrade routes, and managed-engine installs and updates retain their prior dispatch behavior.

Product patch SHA-256: `2fdd748b53cab7b452443f69ecdccf5c4e29d6724b404e0ae89103949d3f0935`.

## Static and aggregate gates

Before the product commit, the controller and frontend TypeScript typechecks, focused ESLint, focused Prettier, shared-contract validator, controller standards audit, and `git diff --check` passed. The normal product commit hook repeated staged lint/format plus both affected typechecks and passed.

The first aggregate attempt reached a successful frontend compile but was infrastructure-invalid. Borrowed dependency symlinks made the standalone `typebox` source and destination resolve to the same directory, so `complete-standalone` exited 1. Its transcript is retained rather than presented as product evidence.

The dependency layout was replaced with self-contained APFS copy-on-write trees without changing source commit `9018edf38`. The second exact `npm run check` passed automation, contracts, structure, frontend static/cleanup/production build, standalone repair and assertion, controller type/lint/cleanup/standards, and agent-runtime build. The only frontend lint diagnostic was the pre-existing non-fatal `ComposerProjectDrawer` complexity warning.

| Evidence                                    | Exit | SHA-256                                                            |
| ------------------------------------------- | ---: | ------------------------------------------------------------------ |
| Infrastructure-invalid aggregate transcript |    1 | `dffd3d03a4e70946938c45c7c02d7ee81afa1653a9a8a73bcd009478be89ff45` |
| Self-contained aggregate transcript         |    0 | `1f02f66da921df72530baa29d52ec969143e8f14c0c3ebed4a575b53e2e14cea` |
| Manual loopback transcript                  |    0 | `6f3d1e035e01dc099afd92149ea05f81f6b517138f20ef7d87265c6cb79543da` |
| Controller live log                         |  n/a | `f6eb71622da68acd87648b3c2db7eddbfaf7c438c73afc243b8a2fa59ca110e0` |
| Artifact hash manifest                      |  n/a | `16228077567ae30dbb46f8ec41a07aec4b7a6e06990510a3901a299f3bcec8d9` |

## Disposable loopback probe

The probe launched the exact product source from a temporary working directory, preventing repository environment-file discovery. It bound only `127.0.0.1:60026`, used an isolated database and data directory, disabled metrics, configured no API key, and used `/usr/bin/true` as the harmless CUDA, ROCm, and SGLang sentinel command.

| Scenario                                    | Result                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| Initial registry                            | HTTP 200, zero jobs                                         |
| CUDA `download`; ROCm `inspect`             | Both HTTP 400; no job added                                 |
| CUDA `install`                              | Terminal error, backend `cuda`, no `command` property       |
| ROCm `install`                              | Terminal error, backend `rocm`, no `command` property       |
| CUDA explicit `update`                      | Terminal success, backend `cuda`, sentinel command retained |
| CUDA omitted type                           | Normalized to `update`, terminal success                    |
| CUDA upgrade route with body type `install` | Forced to `update`, terminal success                        |
| SGLang `install`                            | Terminal success, backend `sglang`                          |
| SGLang `update`                             | Terminal success, backend `sglang`                          |

All assertions passed with seven terminal jobs: five successes and two expected unsupported-install errors. The controller stopped normally; its process was absent and port 60026 was closed afterward.

## Cleanup and remaining boundaries

The controller database, logs, invalid-request bodies, generated dependency trees, TypeScript metadata, `.next`, desktop output, and agent-runtime output were inventoried, removed from the worktree, and moved recoverably to `/Users/sero/.Trash/local-studio-pr362-p2-20260815`.

During dependency reset, an initial command used an unavailable unlink path. Five copy-on-write trees therefore landed as nested `node_modules/node_modules` directories under the canonical dependency directories. They were detected immediately, moved by exact path into the lane quarantine, and proven absent before the aggregate rerun. No canonical tracked file changed.

The product worktree was clean after cleanup. No push, remote CI, desktop package, installed-app run, controller upgrade against a real platform toolchain, or release action was performed.
