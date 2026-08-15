# Theme palette and numeric-control consolidation

Date: 2026-08-15 EDT

Status: **source and isolated headed-render evidence ready for independent integration review; aggregate, packaged, installed, and hosted acceptance remain open**.

## Provenance

- Exact immutable base: `1a2205e95a56a154691654ddc0d0547dbd60f491`.
- Isolated worktree: `/Users/sero/projects/vllm-studio-v201-theme-palette`.
- Branch: `codex/v201-theme-palette-20260815`.
- Product head: `faf4d97d4dd25500b370e72aefb3e9452b5c8019`, tree `74f3ae86a4b86752a9c21d67dc160009acd500fb`.
- External evidence root: `/Users/sero/projects/vllm-studio-v201-evidence/theme-palette-consolidation-20260815`.

The lane was created from the exact base and never rebased or cherry-picked into the canonical checkout. The audited implementations were read from `a25acb7cb7d1f0b7de65ca52d3eeae6410ca252a`, `bd1e497a9cdff3a0edb19bb2e1dabe5618018bca`, and `ad4709cdd1a315fc1c466b00e84f1e09e8dad63f`, then adapted rather than copied wholesale so the base's newer scrim, spinner, icon-scale, dimensions, and tool-preview work remained intact.

## Product commits and scope

The product changes exactly two assigned paths:

- `frontend/src/app/styles/globals/tokens.css`
- `frontend/src/features/settings/appearance-settings.tsx`

The normal pre-commit hook limits a staged change to 600 source lines, so the product was sealed as four independently hook-validated conventional commits:

| Commit                                     | Change                                            | Raw Git delta |
| ------------------------------------------ | ------------------------------------------------- | ------------: |
| `552c722e2f0a67113accada0ff3fc5db84a7ecec` | Share numeric settings controls                   |   +107 / -124 |
| `e20936b38e71cbbf3e288ccebe28b84d4c336149` | Inherit the canonical Tailwind palette            |      +0 / -78 |
| `7c11f34579734939bb90786085e0d8e9c94c0393` | Project light and dark values with `light-dark()` |   +161 / -376 |
| `faf4d97d4dd25500b370e72aefb3e9452b5c8019` | Share scheme-independent aliases                  |     +10 / -61 |

Against the immutable base, Git records 276 insertions and 637 deletions across the two product files, a raw net reduction of 361 lines. The final product source contains no comments. No theme ID, bootstrap function, store contract, runtime persistence API, tool-preview setting, or test file changed.

## Theme contract

The stylesheet now inherits Tailwind's canonical color variables from the existing import that precedes `tokens.css`. Only the two intentional neutral calibrations remain local: `--color-neutral-400` and `--color-neutral-600`.

Scheme-dependent values are declared once on `:root` with `light-dark()`. The existing selectors retain their IDs and only select `color-scheme`:

- `zai-light` and `paper` select light;
- `zai-dark`, `.dark`, and `omlx-dark` select dark;
- the default remains dark.

Scheme-independent derived tokens and compatibility adapters are declared once. Runtime inline custom-theme values still win by inline specificity. Custom dark themes now receive a complete dark projection for values they do not own, while every inline-owned value remains unchanged.

The current-only acceptance tokens are explicit in the final source and browser evidence:

| Contract         | Light                   | Dark                    | Runtime/reduced-motion evidence                                         |
| ---------------- | ----------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `--color-scrim`  | `rgba(0, 0, 0, 0.32)`   | `rgba(0, 0, 0, 0.55)`   | Inline `rgba(1, 2, 3, 0.7)` wins exactly                                |
| `--spinner-warm` | `#7d6242`               | `#e6dcc8`               | Inline `#abcdef` wins exactly                                           |
| spinner motion   | `zai-spinner-rotate 1s` | `zai-spinner-rotate 1s` | Becomes `none 0s` under reduced motion                                  |
| `--icon-scale`   | `0.84`                  | `0.84`                  | Computes to 84 px from a 100 px probe; inline `1.25` computes to 125 px |

The base's accepted sidebar width, row gap/radius/padding, toolbar height, terminal aliases, card/input aliases, Git aliases, tooltip tag foreground, spinner keyframes, and reduced-motion rule also remain. The tool-preview global and per-kind store selectors, options, labels, reset behavior, and settings rows are byte-for-byte unchanged apart from line movement caused by the control extraction.

## Numeric controls and persistence

`SliderSetting` owns the repeated row, slider, accessible label, and monospace display structure. `useNumberControl` owns initialization from the computed CSS variable and updates through the existing `applyUiControl` persistence boundary.

| Control           |   Range |                         Step | Display      | Existing persistence path                             |
| ----------------- | ------: | ---------------------------: | ------------ | ----------------------------------------------------- |
| UI font size      |   12-20 | 1, the shared slider default | px           | Nearest existing `fontSizeId` through `setFontSizeId` |
| UI scale          | 0.8-1.3 |                         0.05 | percent      | `--ui-scale` through `applyUiControl`                 |
| Corner radius     |    0-16 |                            1 | px           | `--radius-base` with `px` suffix                      |
| Chat text size    |   13-18 |                            1 | px           | `--codex-chat-font-size` with `px` suffix             |
| Chat line height  | 1.3-1.8 |                         0.05 | two decimals | `--codex-chat-line-height`                            |
| Chat column width |   40-64 |                            1 | rem          | `--composer-w` with `rem` suffix                      |

Labels, descriptions, ranges, steps, displays, CSS-variable names, suffixes, and callbacks match the base. `applyUiControl` still writes `local-studio.uiControls`, and hydration still invokes `applyStoredUiControls`. The UI font setting still persists in the existing `local-studio-state` store.

Theme persistence behavior is unchanged:

- Light and dark select and persist the existing `zai-light` or `zai-dark` IDs through `setThemeId`.
- System still resolves the current media preference to one of those two IDs and persists that resolved ID; no `system` theme ID was introduced.
- Library themes still persist their existing IDs through the same store action and bootstrap map.
- Custom color edits still write `local-studio.customThemeTokens` and apply the same runtime inline token map.

## Headed computed-style matrix

Agent Browser 0.11.1 ran a headed Chromium session with a new disposable profile at `/private/tmp/vllm-theme-browser-profile-20260815`. The generated page loaded the exact base stylesheet from Git, the exact product stylesheet by SHA-256, and Tailwind's canonical palette. It rendered both stylesheets in isolated frames and compared 251 computed color and adapter tokens plus `color-scheme`, icon width, spinner animation name, and spinner duration.

| Scenario                   | Mode                                  | Result             | Key computed product values                                                                                                                  |
| -------------------------- | ------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical light            | Exact base/product                    | PASS, 0 mismatches | light, white background, 0.32 scrim, warm `rgb(125, 98, 66)`, 84 px icon                                                                     |
| Canonical dark             | Exact base/product                    | PASS, 0 mismatches | dark, `rgb(24, 24, 24)`, 0.55 scrim, warm `rgb(230, 220, 200)`, 84 px icon                                                                   |
| System resolved light      | Exact base/product                    | PASS, 0 mismatches | Same computed contract as canonical light                                                                                                    |
| System resolved dark       | Exact base/product                    | PASS, 0 mismatches | Same computed contract as canonical dark                                                                                                     |
| Custom dark runtime tokens | Inline exact plus intended projection | PASS, 0 mismatches | Inline background `rgb(13, 17, 23)` exact; unowned scrim/spinner and representative terminal/chart/syntax tokens project from canonical dark |
| Paper custom light         | Exact base/product                    | PASS, 0 mismatches | Inline background `rgb(250, 248, 242)` exact; light scrim/spinner projection                                                                 |
| Runtime inline precedence  | Exact base/product                    | PASS, 0 mismatches | Background `rgb(18, 52, 86)`, 0.7 scrim, warm `rgb(171, 205, 239)`, 125 px icon                                                              |

The no-preference run reports `zai-spinner-rotate 1s` in all seven scenarios. A separate headed run with `prefers-reduced-motion: reduce` reports `none 0s` in all seven, with every comparison still passing. Both full-page screenshots were visually inspected: the page rendered all seven result cards, the values were legible, and the PASS status was visible without overlap or blank content.

The base stylesheet SHA-256 embedded in the page is `05a5cd7450ce254bb1f3b250b45de83b1f09b3c5326ec9d867a75a0842ca4d81`. The product stylesheet SHA-256 is `e09f6b887279575f5d0552bc226575d0e31479a446e97dd60f0dbb9b183fcfa0`.

After capture, the headed browser was closed, its exact disposable profile was deleted, and process inspection found no remaining Agent Browser or Chromium process for the lane. No existing browser profile or user data was read.

## Focused gates

The exact product head passed:

- focused Prettier on both product files;
- focused ESLint on `appearance-settings.tsx`, with only the non-failing pages-directory configuration notice;
- frontend TypeScript `tsc --noEmit --incremental false`;
- each of four normal commit hooks, including lint-staged Prettier/ESLint and frontend `tsc --noEmit`;
- `git diff --check`;
- final source-comment scan, with zero matches;
- the headed computed-style matrix in normal and reduced-motion media modes.

No automated test was added, restored, or run. The root `npm run check` was deliberately not run because the parent integration lane owns the serialized aggregate build slot.

## Frozen LOC

cloc 2.10 measured the identical two-file product scope at the immutable base and product head:

| Ref                 |   Blank | Comment |     Code | Raw lines |
| ------------------- | ------: | ------: | -------: | --------: |
| Base `1a2205e95`    |     136 |      85 |    1,244 |     1,465 |
| Product `faf4d97d4` |      71 |       0 |    1,033 |     1,104 |
| Delta               | **-65** | **-85** | **-211** |  **-361** |

Per-file code counts are 649 to 456 for `tokens.css` and 595 to 577 for `appearance-settings.tsx`. This is an exact 211-code-line reduction in the assigned product scope.

## Durable evidence

| Artifact                            |   Bytes | SHA-256                                                            |
| ----------------------------------- | ------: | ------------------------------------------------------------------ |
| `build-matrix.mjs`                  |  15,317 | `84d85e8b852571a8f8e4dd1242fe39767bc85aa318b6657f602598443bc9e4e3` |
| `computed-style-matrix.html`        |  78,469 | `4df5fa6b2baa60aa200449158c9f9af8ba3464efbdb1311658a1aa4e2e489ecf` |
| `computed-style-nomotion.png`       | 237,949 | `c9559c52552ea33993e029865eae47b01ab064092afec658c796e698ad4e37c1` |
| `computed-style-reduced-motion.png` | 231,326 | `2a66a0a3b7a25a92ad89bb874b3c7f5b4ef03e252f2d9e9bfb0cb2418a498018` |

The HTML is self-contained and retains the full result JSON for independent inspection. The JavaScript builder is also retained so a reviewer can regenerate the page from the pinned base and current product file.

## Remaining acceptance

The headed harness proves browser-computed stylesheet behavior, not the complete Next.js settings page or an installed desktop bundle. Parent aggregate `npm run check`, independent source/evidence review, full application keyboard and pointer interaction, reload persistence in the integrated application, production packaging, installation, hosted CI, and installed live behavior remain open. No commit was pushed.
