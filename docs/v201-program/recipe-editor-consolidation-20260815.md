# Recipe editor contract consolidation

Date: 2026-08-15 EDT

Status: **source-ready for integration; aggregate, hosted, installed, and live visual acceptance remain open**.

## Provenance

- Exact immutable base: `4703d716d97d35c222b3c4f5fb1e4fd76ec1bbeb`.
- Contract/type commit: `0c49ca02ddbabfe1fe35794cd1be1edbdab6b9a1`.
- Shared-field commit: `8f5854054c8f86a6cf7ecea7e2286bfe5c7e1bdb`.
- Capability-tab commit: `4ea5d78f1b718180453c142d3a7997c455c169a7`, tree `e0a0fe19c5a8a0a1562b06bf1b7dd9ea645e3e27`.
- Product patch SHA-256: `f6cbd762acbbeea667172229fe16277da4eff0abb11611a8f2db7efddadd39b7`.
- Isolated worktree: `/Users/sero/projects/vllm-studio-v201-recipe-editor`.
- Branch: `codex/v201-recipe-editor`.

The lane was created from the exact base above. It did not rebase, modify, or cherry-pick into the canonical checkout after another lane advanced that checkout.

## Product scope

The product commits change exactly ten assigned paths:

- `controller/contracts/engine-args.ts`
- `frontend/src/features/recipes/recipe-editor.ts`
- `frontend/src/features/recipes/recipe-modal/recipe-fields.tsx`
- `frontend/src/features/recipes/recipe-modal/tabs/option-tab.tsx`
- `frontend/src/features/recipes/recipe-modal/tabs/tab-content.tsx`
- `frontend/src/features/recipes/recipe-modal/tabs/tab-general.tsx`
- delete `frontend/src/features/recipes/recipe-modal/tabs/tab-features.tsx`
- delete `frontend/src/features/recipes/recipe-modal/tabs/tab-model.tsx`
- delete `frontend/src/features/recipes/recipe-modal/tabs/tab-performance.tsx`
- delete `frontend/src/features/recipes/recipe-modal/tabs/tab-resources.tsx`

Git records 667 insertions and 983 deletions, a raw net reduction of 316 lines. No automated test code or source comments were added, restored, modified, or run.

## Consolidated contract

`EngineArgValues` is a mapped type over the field and primitive type of every entry in the canonical `ENGINE_ARG_SPECS`. `RecipeEditor` now intersects canonical `Recipe` and `EngineArgValues`, retaining only editor-specific fields and narrower editor unions as explicit additions. The public recipe and engine-argument types were not weakened.

The source-only mapped type addition leaves the emitted `ENGINE_ARG_SPECS` module behavior unchanged. TypeScript-transpiled base and product output are both 9,601 bytes and have the same SHA-256, `c30c16da620fe7e4f35e77dbb00e3c117b6c802fc1b85126d69912e84c952c21`.

The new shared field binder preserves native controlled inputs, selects, checkboxes, labels, descriptions, required state, icons, placeholders, defaults, section order, and existing shared UI-kit focus behavior. Its value conversion is explicit:

- numeric empty input becomes `undefined`, while `0` and finite negative values remain numbers;
- required recipe-name empty text remains `""`, while optional empty text becomes `undefined`;
- numeric select values remain numbers and default sentinels become `undefined`;
- unchecked values remain `false`;
- the generic path never uses truthiness to replace meaningful `0` or empty values;
- the existing Block Size invalid-zero display rule is represented by an explicit `zeroIsEmpty` option rather than generic truthiness.

The four capability tabs retain their order and names: Model, Resources, Performance, and Sampling & Features. Their prior section/field order, labels, descriptions, visibility checks, defaults, input/select forms, and backend-specific option lists are represented once by `RecipeModalOptionTab`. The general tab uses the same binder for common fields and keeps the existing one-line Serve pipeline-label styling. The content dispatcher still mounts General, Environment, Command, and the selected capability tab through the same modal boundary.

## Disposable parity probes

The probes compiled source into disposable temporary modules and rendered components with disposable mocks. They are evidence probes, not committed test code.

### Save, reload, and generated command parity

The runtime probe emitted 12 records: `vllm`, `sglang`, `llamacpp`, and `mlx`, each with populated, edge, and missing-value scenarios. Populated and edge scenarios cover all 64 `ENGINE_ARG_SPECS` fields plus recipe identity, host, arbitrary and zero ports, served name, aliases, `extra_args`, `env`, device selectors, booleans, numeric zero, empty strings, missing values, arrays, and objects.

For every record it compared `prepareRecipeForSave`, JSON save/reload, and generated command output. Base and product artifacts are byte-identical at SHA-256 `5a74f35c1e234527227399b63a31e94e7ca171a0ee523db3269b22a105ba5eab`.

### Field semantics

The focused field probe records ten transitions and four display cases. It proves number `0`, number `-1`, string `"0"`, empty required name, optional empty-to-`undefined`, numeric select conversion, default/empty select-to-`undefined`, and `false` checkbox preservation. It also proves displayed seed `0`, displayed empty name, Block Size zero fallback `16`, and dtype empty fallback `auto`.

Artifact SHA-256: `3e74183b3a815996a4e8a5795236b21de503247c968d3bd67df1cba2b7ab02b8`.

### Rendered structure parity

The render probe emitted 36 backend/tab/scenario records. After normalizing React-generated `useId` tokens and explicit versus implicit text-input type, all 18 populated records are structurally exact. Twenty-nine of 36 total records are exact before the intended numeric-zero correction. The remaining seven edge records differ only because meaningful numeric zero now renders as `0` instead of blank. After normalizing that correction, all 36 records are exact.

This covers field, section, option, text, order, and layout structure. It does not replace a live keyboard, focus, or perceptual browser pass.

## Focused static gates

The exact product head passed:

- all three normal commit hooks, including lint-staged, Prettier, ESLint, frontend TypeScript, and the applicable controller TypeScript check;
- full frontend `tsc --noEmit`;
- controller `tsc --noEmit`;
- focused frontend ESLint across all retained and added recipe-editor files;
- focused controller ESLint on `controller/contracts/engine-args.ts`;
- focused Prettier across all retained and added product files;
- shared contract validation;
- repository structure validation;
- frontend circular-dependency analysis across 518 files, with zero cycles;
- frontend UI-structure validation;
- `git diff --check`;
- retained product-source comment scan, with zero matches.

No automated test was added or run. The root `npm run check` was deliberately not run because the parent integration lane owns the serialized aggregate build slot.

## Frozen LOC

Pinned cloc 2.06 measured the identical assigned product scope at the immutable base and product head with `--timeout 0 --by-file --csv`:

| Ref | Files | Blank | Comment | Code |
| --- | ---: | ---: | ---: | ---: |
| Base `4703d716d` | 8 | 81 | 0 | 1,434 |
| Product `4ea5d78f1` | 6 | 67 | 0 | 1,132 |
| Delta | **-2** | **-14** | **0** | **-302** |

The cloc fixture was removed after measurement.

## Durable evidence

Curated artifacts are retained under `/Users/sero/projects/vllm-studio-v201-evidence/recipe-editor-consolidation-20260815/`.

| Artifact | SHA-256 |
| --- | --- |
| `runtime-pre-4703d716d.json` | `5a74f35c1e234527227399b63a31e94e7ca171a0ee523db3269b22a105ba5eab` |
| `runtime-post-4ea5d78f1.json` | `5a74f35c1e234527227399b63a31e94e7ca171a0ee523db3269b22a105ba5eab` |
| `render-pre-4703d716d.json` | `0be4ffa394d3424576ef41692c646b9e2c5f5230f57610136f43b7cee19a0ac7` |
| `render-post-4ea5d78f1.json` | `61f3cf54523059db26edeabda5a63bb0a5b0056902222558f3e60fd7edfd327f` |
| `render-parity-4ea5d78f1.json` | `2321d6f27e2226fb559a532bdcca242d8bbdba4c10c03e103468a68b16c2b2d7` |
| `field-edge-4ea5d78f1.json` | `3e74183b3a815996a4e8a5795236b21de503247c968d3bd67df1cba2b7ab02b8` |
| `cloc-base-4703d716d.csv` | `04077c16a7bb8226f7d8e9b4d2b3bda924301e1021c58f5f434671208ddf88fa` |
| `cloc-head-4ea5d78f1.csv` | `a02ce19161fc345fe122ca56243ee4823ab30f20616294c00515783d62a9d3aa` |

The disposable runtime, render, and field probe harnesses had SHA-256 values `3665ef10ed8425274e5309f41a95c02a15ed4f30e24f29dcc3ac2f15c0dd1d0f`, `31cca0e82c59aaf0796643c8b1d185b911a6faf5f8f81f949c7b778e2df0315f`, and `58554ec000a2a7a155e19c987e0384fa2e359ad6fab8b01dc3f5b2c7541176c2`. They were deleted after the committed source was probed.

## Invalid browser attempt

The first manual browser attempt is not acceptance evidence. A development preview on port 34129 was started before the full process tree had a proven disposable home and controller-settings path. The rendered page reached live controller inventory. No field was clicked, saved, launched, or stopped, and the browser was closed immediately.

Existing UI hydration issued exactly two `POST /api/settings` requests. Those requests reached the live settings route and may have rewritten the live settings file. Only the already-recorded safe metadata is retained: size 140 bytes, mode `0600`, and mtime `2026-08-15 11:26:17 EDT`. No preimage exists. The file was not restored, read again, hashed, or reproduced after the incident.

No retry was attempted because isolation of the existing browser automation daemon from `~/.local-studio` could not be proven for its entire process tree. Final checks found no listener on ports 34129 or 34130 and no first-attempt preview process. The preview, live visual state, and installed application state are all invalid or unproven for this slice.

## Cleanup and remaining acceptance

The worktree's four lane-owned dependency clones, generated `frontend/.next`, disposable cloc fixture, and three probe harnesses were removed. The curated external JSON/CSV artifacts remain. No preview listener or lane preview process remains.

The commits are not pushed and have no hosted CI. Parent aggregate `npm run check`, independent integration review, a credential-free process-tree-isolated browser pass, keyboard/focus/perceptual verification, built application validation, installation, and installed live behavior remain required before acceptance.
