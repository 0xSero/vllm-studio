# Configure retirement: operator tools

Date: 2026-08-15

Status: **source-ready for integration; aggregate and installed acceptance remain open**.

## Provenance and scope

- Exact base: `3e247a65c2241db87054fb9135dd9d258d859b18`.
- Product commit: `aeb3da96a4d9e714bd8e391f7f0d344ee0a42784` (`refactor(settings): surface operator tools`).
- Product diff: one owned file, `frontend/src/features/settings/system-settings-section.tsx`, with 38 additions and 1 deletion.
- The slice adds no route, fetch, state, shared component, backend URL, API key, CSP change, or source comment. It does not touch the Settings view or link `/api/proxy/api/docs`.

## Behavior

`SystemDetails` now renders a private `OperatorTools` component immediately before Machine details. Its `SettingsGroup` is always visible and non-collapsible and contains exactly two rows:

1. Logs uses a Next `Link` to `/logs`, styled with `buttonClasses("ghost", "sm")`, with visible text `Open logs`.
2. Controller API uses the existing external `SettingsLink` to the same-origin `/api/proxy/api/spec`, with visible text `Open specification`, accessible label `Open controller API specification in a browser`, and an `aria-hidden` external-link icon.

The same-origin proxy target lets the existing proxy supply the selected controller authorization without placing a backend URL or credential in the visible link. A read-only probe against the previously installed development app found `/logs` at HTTP 200. An unauthenticated request to `/api/proxy/api/spec` returned HTTP 307 to the same-origin `/access` boundary and completed there at HTTP 200; this proves the route remains same-origin and does not bypass authorization, not that the new source is installed.

## Focused validation

- One-file Prettier check: PASS.
- One-file ESLint from the frontend package directory: PASS.
- Frontend TypeScript `tsc --noEmit`: PASS.
- Normal product commit hook: PASS; lint-staged ran ESLint and Prettier on the source file, then the frontend typecheck passed.
- Disposable read-only source probe: PASS for private placement, one non-collapsible group, exactly two rows, both exact href and text contracts, ghost/small button classes, the exact accessible label, decorative icon, no docs link, and no fetch/state.
- `git diff --check 3e247a65c..aeb3da96a`: PASS.
- No automated test code was added, modified, restored, or run.

The first raw ESLint invocation was deliberately retained: it ran from the repository root and therefore could not find the frontend package config. The first TypeScript invocation was also retained: the isolated worktree initially lacked `shared/node_modules`, so unrelated Effect types did not resolve. Neither invocation changed source. After linking the worktree to the already-installed pinned dependency tree, the package-scoped reruns above passed.

## LOC

Pinned cloc 2.06 (`ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`) measured the one changed production file:

| Ref                 | Files | Blank | Comment |    Code |
| ------------------- | ----: | ----: | ------: | ------: |
| Base `3e247a65c`    |     1 |    22 |       0 |     312 |
| Product `aeb3da96a` |     1 |    23 |       0 |     348 |
| Delta               |     0 |    +1 |       0 | **+36** |

This slice increases the frozen product ledger by 36 code lines. The parent integration must recompute the aggregate product total after composing all Configure-retirement stages.

## Durable evidence

External directory: `/Users/sero/projects/vllm-studio-v201-evidence/configure-stage3-operator-tools-20260815/`

| Artifact                           | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `operator-tools-source-probe.mjs`  | `ec41b19b86240568d9f7357d19fb2a940be5b3a35b297f8982eea05d13d84423` |
| `operator-tools-source-probe.log`  | `ad6cc528cc39676d81261922d533c25b8259172123ecfc9a81cb49ef1611418b` |
| `prettier-check.log`               | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `eslint-r2.log`                    | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `frontend-typecheck-r2.log`        | `18f20b008a6922ef78a8750c2110537568104991928628d334eba0dcbcca01d0` |
| `installed-http-logs.log`          | `6ff0bf9c9a07f5e3ab4e2126366e118fef46591870db83b64f329d478ca1d349` |
| `installed-http-spec-redirect.log` | `7c66998be82f88170b28b62d3e9b904a20b08d9ee60f5980bf03eaaa1a0f3e02` |
| `installed-http-spec-follow.log`   | `2fad147989f7e8b91aa4cb57b462742b1130a81ca5d700f783d9bec71f2e9f31` |
| `cloc-base-3e247a65c.csv`          | `b129dfd4f819cd127090b248361484d7e53fc42ecab1e72f99e72004556821a7` |
| `cloc-product-aeb3da96a.csv`       | `72d135f921d4b886bdf27494021197ede152318d77a78e4283465759a851063c` |
| `product-commit.log`               | `8fc062c224337f3883c48b5ce6c0408b9c15d0fc934c67ec46ee235acc628a41` |
| `diff-check.log`                   | `60cb8679afefb082fb8c4cc58f780466735c28e09f9131596b6f6cb303475643` |

## Remaining gates

The root `npm run check` was intentionally not run because the parent lane holds the shared build slot. The exact product commit has not been integrated into the canonical branch, rebuilt, installed, visually exercised in Settings, verified at narrow widths, or accepted with an authenticated controller-spec session. Independent review, aggregate frozen LOC, push, hosted CI, and the rest of the staged Configure retirement also remain parent-lane work.
