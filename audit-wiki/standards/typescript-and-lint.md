# TypeScript and lint

Verified 2026-06-09 by reading every tsconfig and ESLint config and running the
check commands read-only.

## TypeScript rigor varies sharply by package

There is **no root tsconfig and no tsconfig for `shared/`** — shared contracts
are type-checked only transitively when imported. Four configs exist, and the
controller is markedly stricter than the rest:

| Flag | controller | frontend | desktop | cli |
| --- | --- | --- | --- | --- |
| `strict` | yes | yes | yes | yes |
| `noUncheckedIndexedAccess` | **yes** | no | no | no |
| `exactOptionalPropertyTypes` | **yes** | no | no | no |
| `noPropertyAccessFromIndexSignature` | **yes** | no | no | no |
| `noImplicitOverride` / `noImplicitReturns` / `noFallthroughCasesInSwitch` | yes | no | no | no |
| `isolatedModules` | no | **yes** | no | no |
| target | ES2022 | ES2017 | ES2022 | ESNext |

The CLI config is minimal (`strict` + `skipLibCheck` only). The frontend leans
on Next defaults plus `isolatedModules`. Only the controller turns on the
index-access and optional-property strictness that catches the subtle bugs.

### The controller typecheck is currently failing

At the time of this audit, `tsc --noEmit` in the controller **fails with two
errors**, both in `controller/src/modules/proxy/openai-routes.ts` (lines 322
and 391, TS2769 — `ArrayBufferLike`/`SharedArrayBuffer` not assignable to
`BodyInit`). Frontend and CLI typecheck clean (0 errors). This matters because:

- Root `npm run check` would fail at `check:controller`, and CI's controller
  job would also fail.
- **No local hook would have caught it** — the pre-commit and pre-push hooks
  run frontend checks only (see [Process and releases](process-and-releases.md)).

It is a concrete instance of the enforcement asymmetry described throughout
this section.

## Frontend ESLint: the strictest config in the repo

`frontend/eslint.config.mjs` (178 lines) extends `eslint-config-next`
core-web-vitals + typescript and adds `eslint-plugin-boundaries`. The rules
that define the project's character:

- **500-line caps as errors.** Both `max-lines` and `max-lines-per-function`
  are `["error", { max: 500, skipBlankLines, skipComments }]`
  (`eslint.config.mjs:39,41`).
- **Banned React effect hooks.** A `no-restricted-syntax` error bans
  `useEffect`/`useLayoutEffect`/`useInsertionEffect` (`:6-17,42-49`); the names
  are built by string concatenation (`"use" + "Effect"`) so the config file
  itself does not trip greps. A second "no carve-outs" ban covers
  `src/app/agent/_components/**` (`:150-165`). This is the rule behind the
  effect-hook-replacement campaign noted as complete in `STATUS.md`.
- **Legacy allowlist.** Lines 106-149 list **33 files** where the size caps are
  downgraded to warnings, with a comment mandating removal once each drops
  under 500 lines (and stating the effect-hook ban is never softened).
  `src/lib/themes.ts` and `*.d.ts` are exempted outright.
- **Layer boundaries.** `src/lib` must not import `@/app/*` (error); app must
  not import app (warn). Complexity 20, max-depth 4, max-params 5 are all
  warn-level.

Current state: `eslint .` passes with **0 errors, 2 warnings**
(`agent-browser.tsx` at 570 lines, allowlisted; `pi-runtime-compaction.ts:55`
complexity 23). One live escape hatch exists — `src/ui/dropdown-menu.tsx:47`
carries the only `eslint-disable-next-line no-restricted-syntax` in the
frontend, calling `useEffect`.

## Controller and CLI lint

- **Controller** (`controller/eslint.config.mjs`): type-aware typescript-eslint
  plus `eslint-plugin-unicorn`. Errors on `no-explicit-any`,
  `explicit-function-return-type`, `consistent-type-imports`,
  `switch-exhaustiveness-check`, `eqeqeq`, `no-throw-literal`,
  `max-lines-per-function` 500, and `unicorn/prevent-abbreviations`. **No
  `max-lines` file cap** — only the per-function cap. Passes clean.
- **CLI** (`cli/eslint.config.mjs`): the same typescript-eslint core without
  unicorn or size caps. Passes clean.

No package lacks lint entirely, but **`shared/` and `scripts/` are linted by
nobody**, and `scripts/*.mjs` sits outside every config.

## Formatting

Per-package `.prettierrc.json`, and they **diverge**: the frontend uses
`printWidth: 100, trailingComma: "all"`; controller and CLI use
`trailingComma: "es5"`. There is **no import-ordering plugin anywhere**.
Prettier is enforced only via `lint-staged` on frontend commits; controller and
CLI have manual `format` scripts and **no CI format check**.

## See also

- [Contracts and structure](contracts-and-structure.md)
- [Process and releases](process-and-releases.md)
- [State: debt and hygiene](../state/debt-and-hygiene.md)
