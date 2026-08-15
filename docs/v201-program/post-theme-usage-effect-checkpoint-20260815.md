# Theme, usage, and Effect adapter checkpoint

Date: 2026-08-15 EDT

Status: **source, independent review, aggregate repository, frozen LOC, and isolated recipe-browser gates are green. Final hosted, installed desktop, release, and cross-app acceptance remain open.**

## Exact checkpoint

- Immutable composition base: `1a2205e95a56a154691654ddc0d0547dbd60f491`.
- Accepted application/product head: `c669a8c7e46eca5b19f3c390aa1c2bdca61e6224`.
- First evidence commit: `1838bfa4f`.
- Branch: `feat/v201-consolidation`, PR #408 into `dev`.
- Shared refs remain `origin/main` `eeeb3406d4bcef255b6405c5508fb324d5e38e77` and `origin/dev` `a765eb27bca4baffabc6dc84c553fc6d8be5590d`.

Before final reconciliation, concurrent validator work published intermediate head `00d48729f5f173886f685f63d0c981eeb81f3a48`. Hosted run [31898202968](https://github.com/sybil-solutions/local-studio/actions/runs/31898202968) completed successfully there: desktop-package, agent-runtime, gates, dependency review, frontend, secret scanning, CodeQL Analysis, and controller all passed, as did the separate head-bound CodeQL check. This is useful intermediate source/package evidence, not final-head acceptance.

## Accepted slices

### Theme palette and controls

Canonical commits `292ce73dd`, `a1483ab76`, `cd480f1f0`, and `0b88dadf2` are byte-identical on both product paths to reviewed isolated tip `faf4d97d4dd25500b370e72aefb3e9452b5c8019`. Evidence is recorded in `theme-palette-consolidation-20260815.md` and canonical evidence commit `f42314218`.

The slice removes 211 frozen product-code lines. The isolated headed matrix passed 251 computed color/adapter tokens across light, dark, system-light, system-dark, paper custom, custom dark, and runtime-inline scenarios. Separate normal and reduced-motion runs preserve the current scrim, spinner, icon-scale, runtime override, and motion contracts. Independent review returned GO with no P0-P2 finding.

### Usage normalization and response boundary

The published intermediate b0 commits `ca5341bd4`, `dfcc3eaef`, and `693f5e2e5` were not accepted alone. Final canonical history adds concurrent cherry-pick `bc677006d` plus integration correction `c669a8c7e`. The seven usage product paths at `c669a8c7e` are byte-identical to reviewed isolated tip `e464af84108b084a4a8a6d32cfec32855314bda7`; the nullable SQLite projection helper is restored byte-for-byte from the validated base.

The final architecture keeps the browser projector pure, defines the complete normalized DTO with Effect v4 Schema in a controller-only module, validates the final cached/noncached response after optional controller composition, recovers primary validation failures through the existing logged empty-response path, validates that recovery, and emits no invalid JSON if recovery is malformed. Exact route recovery, SQL/SQLite, caller, bundle-graph, latency, and memory probes pass. A genuine 73.524 ms full-decode intermediate failure remains preserved and superseded; the final endpoint-boundary maximum is below 20 ms across the retained fresh-process runs.

This slice removes only 44 frozen product-code lines. It is accepted as a correctness and canonical-boundary tradeoff, not represented as the originally projected high-payoff LOC reduction. Independent source review and the sealed evidence review both returned GO with no P0-P2 finding. Evidence is in `usage-normalization-20260815.md`; the isolated final evidence commit is `124b3658340a1491cfe4b13dd58ff4466c66c8f5`.

### Typed Effect route adapter

Canonical commits `f22746a44`, `2afbd3be4`, `f738eb31a`, and `2e89913e1` are byte-identical on all seven product paths to reviewed isolated tip `379eaea134ba5fed35348bfd2bef9daffddd2fb0`. The adapter owns the repeated `method(path, documentRoute, effectHandler(handler))` composition for 29 routes without changing route order, handler ASTs, declarations, Hono RPC output, JSON, SSE, failure, interruption, or OpenAPI behavior.

The slice removes 78 frozen controller code lines. Independent review returned GO with no P0-P2 finding. Evidence is in `effect-route-adapter-20260815.md`.

## Aggregate repository gate

The exact root `npm run check` passed at application/product head `c669a8c7e`:

- automation layout, shared-contract ownership, and barrel/sibling structure passed;
- frontend ESLint completed with only the pre-existing non-failing `ComposerProjectDrawer` complexity warning;
- frontend, desktop, and extension TypeScript checks passed;
- cycle, UI-structure, Knip, duplicate, and dependency checks passed;
- Next production compilation, all 22 static pages, standalone repair, and minimal-standalone assertion passed;
- controller typecheck, lint, Knip, zero-clone jscpd, depcheck, and standards passed;
- agent-runtime build and 180-specifier postbuild passed.

Evidence root: `/Users/sero/projects/vllm-studio-v201-evidence/post-theme-usage-effect-20260815`.

| Artifact                        | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `root-npm-check-c669a8c7e.log`  | `82af086197b7550342a098ed71e23911a97a431e7926ef11848ca50da1d30da0` |
| `root-npm-check-c669a8c7e.exit` | `e3a60fdde876d0f385644030ccb144533271c46a6ce5da6eeeb90e2ac8552367` |

## Frozen LOC

Pinned cloc 2.06 with `--timeout 0` used the unchanged frozen product-file pipeline.

| Ref                 | Files | Blank | Comment |    Code |
| ------------------- | ----: | ----: | ------: | ------: |
| Frozen baseline     |     — |     — |       — | 107,556 |
| Base `1a2205e95`    |   803 | 8,264 |   3,856 | 102,732 |
| Product `c669a8c7e` |   803 | 8,242 |   3,771 | 102,399 |

The current product is 5,157 code lines below the frozen baseline and remains 21,732 lines above the target of 80,667. This checkpoint therefore advances but does not complete row 1.1.

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `production-files-c669a8c7e.txt` | `1933347561cc8e59dd5221d82e505deeaa1117b45e06c9a24efa472f07acf7ef` |
| `cloc-c669a8c7e.csv`             | `bb8790728e18b4ab5bce621772e57774d24c54506caa1f2207ef660407fa2c1f` |

## Recipe browser correction

The earlier recipe preview that reached live controller inventory remains invalid and disclosed. A later isolated rerun is accepted as standalone-browser evidence. Its controller, frontend, runtime, browser profile, HOME, databases, models, project, workspace, Pi, and session paths all used one disposable root; all 60 requests stayed on assigned loopback ports. The application made one normal settings POST only to the disposable 0600 settings file.

The fresh headed run passed 31 of 31 checks: legacy route canonicalization, visible navigation, keyboard-opened New Serve, all seven tabs, focus and state retention, exact numeric zero preservation, Trust Remote Code toggle, disabled save without weights, cancel without mutation, and zero failed requests/console errors/page exceptions. Manifest: `/Users/sero/projects/vllm-studio-v201-evidence/recipe-editor-browser-20260815/manifest.md`, SHA-256 `e62a27d4e3a2b1b4cf8eb3b3ef7614bdfcb9149e434a4c20c2343e9257e901d2`.

This is not installed Electron, real-weight save/launch, or release-package acceptance.

## Concurrent mutation record

Two validator-scope violations affected canonical history. The first integrated and pushed the exact intermediate theme/usage/Effect source plus the temporary dead-helper cleanup; an independent read-only audit verified every product blob and isolated the usage HOLD before forward correction. A second unowned writer created `bc677006d` and left three dirty paths. The two usage-contract hunks would have reintroduced a runtime schema edge into the browser contract, and the `project.mjs` Bun-discovery hunk was unrelated and unreviewed. Their exact patch, file hashes, timestamps, and attribution boundary were preserved in `/Users/sero/projects/vllm-studio-v201-evidence/concurrent-canonical-mutation-20260815/manifest.md`, SHA-256 `38370f963f83a7db393c102ac1367a0a2f3d232c5402482fe5a9093e4b3432ab`, before only those uncommitted hunks were reversed. Published history was not rewritten.

## Cleanup and remaining boundaries

The old canonical `.next`, desktop dist, agent-runtime dist, `next-env.d.ts`, and TypeScript build info were moved recoverably out of the worktree before the authoritative build. The aggregate gate regenerated its own ignored outputs. The isolated usage lane moved 3.1 GiB of dependencies and generated output recoverably to Trash; its tracked and ignored status is clean. No user-authored source was deleted.

Remaining boundaries include final-head hosted CI, installed settings/theme/recipe interaction, DB Stage B/versioned backup and restore, the remaining 21,732-line product reduction, Responses and Anthropic passthroughs, multi-model/multi-port authority, session/history/browser primitives, performance budgets, physical Litter pairing, final reviews, merge, release, and user-approved cleanup.
