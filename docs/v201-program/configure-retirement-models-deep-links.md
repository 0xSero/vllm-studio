# Configure retirement: Models deep links

Date: 2026-08-15

Status: **focused implementation GO for integration; aggregate and installed acceptance remain open**.

## Provenance and scope

- Exact base: `e4b2c248e6523d5e2d3bc884c562517f0611d2e3`.
- Product commit: `00460a5a7861fa2157cd19a59ecd09dbc09488b2`.
- Product tree: `2d5e094876c692174e311539b754dba4f839b5f2`.
- Branch: `codex/v201-models-deeplinks-20260815`; not pushed.
- Product scope: `recipes-content-model.ts`, `recipes-content-view.tsx`, and `use-dashboard-data.ts` only.
- This stage does not rewrite the `/configure` shim, relocate Integrations, delete Configure, change controller behavior, or add or run automated tests.

## Accepted contract

| Entry or action                                  | Result                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct/reloaded valid Models tab URL             | Picks, Get, Serves, or Downloads renders to match the `tab` value.                                                                                        |
| Invalid or absent `tab`                          | Picks renders.                                                                                                                                            |
| Browser Back/Forward between Models query states | The visible tab resynchronizes with the restored URL.                                                                                                     |
| `/models?new=1&tab=serves`                       | One blank Serve editor opens on marker arrival.                                                                                                           |
| Another URL write while `new=1` remains present  | The editor does not reopen after it is closed.                                                                                                            |
| `new=1` disappears, then later returns           | The marker rearms and opens one blank Serve editor.                                                                                                       |
| Standalone Models tab selection                  | `history.replaceState` preserves `history.state` and emits exactly `/models?tab=<id>`, dropping `new`, legacy `section`, hash, and unrelated query state. |
| Embedded Configure tab selection                 | Existing Configure query state remains intact, `tab` changes, `#models` remains, and `history.state` is preserved.                                        |
| Dashboard New Serve                              | Navigates to `/models?new=1&tab=serves`.                                                                                                                  |
| Dashboard View all                               | Navigates to `/models`.                                                                                                                                   |

The model observes normalized scalar URL state instead of the `useSearchParams` object identity. A retained-marker latch prevents duplicate opens across subscriptions and URL rewrites. The latch resets only after `new=1` is absent. Tab changes while the marker remains active still update the visible embedded tab without reopening the modal.

## Validation

| Gate                                                                      | Result              |
| ------------------------------------------------------------------------- | ------------------- |
| Prettier, three product files                                             | PASS                |
| ESLint, three product files                                               | PASS                |
| `tsc --project frontend/tsconfig.json --noEmit --incremental false`       | PASS                |
| Product commit hook: lint-staged ESLint/Prettier plus `npm run typecheck` | PASS                |
| `git diff --check`                                                        | PASS                |
| Source-comment scan across all three product files                        | PASS, zero comments |

A dedicated browser session drove the real Next.js 16.2.12 route on the exact product bytes. All four valid direct tabs rendered their matching heading; invalid normalized to Picks; `new=1` opened one editor with an empty Name field; Back/Forward restored Get and then reopened one Serve editor; a retained-marker embedded tab rewrite left the editor closed; and a standalone Downloads selection emitted `/models?tab=downloads` while preserving a seeded history-state value.

The focused runtime probe was read-only with respect to controller-backed model data. No Serve was saved, launched, stopped, edited, or deleted.

## Size

Git records 26 insertions and 12 deletions across three files. The frozen cloc 2.06 tool (`ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`) counted 479 code / 4 comment lines at the base and 497 code / 0 comment lines at the product commit: net **+18 production code lines**, with all four pre-existing source comment lines removed.

## Durable evidence

Evidence directory: `/Users/sero/projects/vllm-studio-v201-evidence/models-deeplinks-20260815/`.

| Artifact                               | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `runtime-probe.md`                     | `1b73f7e26efa1015d558838eefc31e486d0e8c9941998da395aa7b540d86d028` |
| `models-new-serve.png`                 | `02c1b506ec33a76da4b55618bcda89e280132ac0a559d3342871c73f8b009ed4` |
| `configure-embedded-get-no-reopen.png` | `8ffa9814702a9be696d43257553e8dae7a08fb698de0a558cdd9c23586572819` |
| `cloc-base-e4b2c248e.csv`              | `773b9e27269279bfb17d6b09853256e945984e6b45854e53165a5bf6f69f00a2` |
| `cloc-product-00460a5a7.csv`           | `036db28ce007bb945dbbec2ca0c4d97c6ac6a1eb6c75b942f3f082784f5c57b8` |

## Remaining acceptance

- The root-owned aggregate `npm run check` was deliberately not run in this lane.
- The slice has not been cherry-picked, pushed, or exercised by hosted CI.
- Installed desktop cold launch, direct-link launch, reload, Back/Forward, narrow-window behavior, and restart remain unproven.
- The later compatibility shim, Integrations relocation, Configure retirement, and persisted-rigs proof remain separate stages.
