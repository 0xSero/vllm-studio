# Configure Integrations relocation evidence

Date: 2026-08-15 EDT

## Provenance

- Worktree: `/Users/sero/projects/vllm-studio-v201-configure-integrations`
- Branch: `codex/v201-configure-integrations-20260815`
- Exact base: `e4b2c248e6523d5e2d3bc884c562517f0611d2e3`
- Product commit: `d6ea7173a4e3fa28bf04d9cefe206bdfd6502406` (`refactor(settings): relocate integration controls`)
- Product patch SHA-256: `5f62cbb28b8e885152b82c314ccfe0f6a25b662e386f350abff0d5ca6b87f1a3`

This stage makes Settings the canonical owner of the existing integration controls without deleting the still-embedded Configure surface. It is a relocation and navigation change, not a panel, API, contract, or persistence rewrite.

## Behavior

- Settings now has an Integrations section that renders the existing `IntegrationsContent`. The outer Settings refresh action is hidden only for that section; the integration surface retains its own scoped refresh action.
- `integrationSettingsHref` emits `/settings?integration=<tab>#integrations`. `plugins`, `connectors`, `models`, and `skills` survive; missing and invalid values normalize to `plugins`.
- Legacy Settings fragments `#connectors` and `#skills` synchronously normalize to the corresponding canonical URL before the integration content mounts. The replacement does not add history or trigger a redirect loop.
- `/integrations` is now a client compatibility shim that calls `router.replace`. A non-empty `integration` query wins over the fragment; a missing or empty query falls back to the fragment; invalid selected state normalizes to Plugins.
- Query-only navigation under the constant `#integrations` fragment is reactive. Settings consumes Next search parameters and keys `IntegrationsContent` to the validated live query, so Plugins → Connectors → Models → Skills navigation, query-only router navigation, and back/forward remount the wrapper with the requested tab instead of retaining stale state.
- The composer Plugins action emits `/settings?integration=plugins#integrations` directly. The command palette replaces its Configure catch-all with direct Models, Integrations, System, and Logs destinations; integration-specific search terms belong to Integrations.
- Configure continues to render the unchanged `IntegrationsContent`. Its current query parsing and tab URL writer remain available until the later compatibility-shim stage retires the aggregate UI.

## Preservation boundary

The product diff is exactly five owned source files, 90 insertions and 20 deletions. The shared wrapper and all four panel blobs are identical at the base and product commit:

| Preserved file                                                   | Git blob                                   |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `frontend/src/features/integrations/integrations-page.tsx`       | `5d14ddc4693790bd03aaa21a9604baa3379362de` |
| `frontend/src/features/integrations/plugins-section.tsx`         | `474ad8ee0181bbf7b8f0b96f95835d1340a2c1f0` |
| `frontend/src/features/settings/connectors-section.tsx`          | `17c4695250f4e0f3c337162295e2e13ed8da01a1` |
| `frontend/src/features/integrations/model-providers-section.tsx` | `507a356c248c1c1c293ce1996519a077998c9dbf` |
| `frontend/src/features/integrations/skills-section.tsx`          | `9dad0a109a6368a141cea961976fdf6e6130cd74` |

No panel, API route, controller contract, runtime service, database, settings persistence, package, lockfile, or automated-test path changed. Every touched product source file has zero source comments.

## Focused validation

- The normal unbypassed product commit hook passed staged ESLint/Prettier and the complete frontend TypeScript check.
- Exact-product focused Prettier, ESLint, and `npm run typecheck` reruns passed.
- A disposable route-mapping probe covered 13 builder, default, query-first, fragment-fallback, invalid, and legacy cases; all 13 matched.
- A disposable same-hash matrix traversed Plugins → Connectors → Models → Skills. Every URL retained `#integrations`, while every validated remount key changed with the query.
- Independent exact-diff review returned GO with no P0, P1, or P2 finding after the query-only synchronization correction.
- `git diff --check` passed. No automated test was added, modified, restored, or run.

Two earlier TypeScript invocations lacked the fresh worktree's sibling package dependency links and failed only at dependency resolution. Read-only links to the canonical dependency trees were attached, the unchanged source passed, and the links plus the disposable base export were moved recoverably to `/Users/sero/.Trash/local-studio-configure-integrations-generated-20260815`.

## Scoped LOC

Pinned cloc 2.06 (`ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`) measured the same five source files at both refs:

| Ref         | Files | Blank | Comment |  Code |
| ----------- | ----: | ----: | ------: | ----: |
| `e4b2c248e` |     5 |    51 |       0 | 1,528 |
| `d6ea7173a` |     5 |    54 |       0 | 1,595 |
| Delta       |     0 |    +3 |       0 |   +67 |

This compatibility wiring adds 67 scoped code lines. The later Configure and duplicate Server deletion supplies the audited reduction; the canonical integration lane must recompute the full frozen product manifest after composition before changing the program LOC ledger.

## External evidence

Directory: `/Users/sero/projects/vllm-studio-v201-evidence/configure-integrations-20260815/`

| Artifact                                | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `prettier-check-d6ea7173a.log`          | `f9cd7f839ad1748922aa602dfa2535c03e4513c3ef233214e87bf03cb25d779c` |
| `eslint-focused-d6ea7173a.log`          | `8a1395000b030c7453e2bd16cfa00338d63db083dff27d892d74229d13214c8b` |
| `frontend-typecheck-d6ea7173a.log`      | `18f20b008a6922ef78a8750c2110537568104991928628d334eba0dcbcca01d0` |
| `route-mapping-probe-r2.log`            | `321974291ea22e4c33424f06b6e73004cb7a32390bf2a57eba2611d0388cd17d` |
| `same-hash-key-matrix.log`              | `0a297d7b02971a063c98156ccf77efffc633c0eb7727ee168489abc463e84cf3` |
| `product-proof-d6ea7173a.log`           | `4adec1fe7e7fbf871587fa8fb514e19db85532c30df7e9c747bb04bd734f9872` |
| `cloc-base-five-files.csv`              | `68367742ff4addf9a9c4694646bb52208646ee57854135f91b2f9149140ec368` |
| `cloc-product-five-files-d6ea7173a.csv` | `e084cf55bd2bf4731c57ac32af6710f4ceb4c99af77962e05f25c2e541d9c4fb` |

## Remaining acceptance gap

The aggregate `npm run check` was intentionally not run while the shared build slot was held. This branch has no production build, live browser, installed desktop, narrow-window, reload, back/forward, restart, push, or hosted-CI proof. Canonical composition must run the aggregate gate, exercise all four real panels and legacy URLs on the exact built surface, and then complete installed acceptance before Configure retirement or GOAL row 2.4 can be accepted.
