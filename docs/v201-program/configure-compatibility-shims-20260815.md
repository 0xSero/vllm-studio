# Configure compatibility shims

Date: 2026-08-15 EDT

Status: **focused implementation GO for integration; composed aggregate and installed acceptance remain open**.

## Provenance and scope

- Exact base: `dcef2b40ed25320c71e5e4bb80c375f5cbf1b707`.
- Product commit: `92bf74a8a7b5782bd7e3a90481a12acf1fa73d6c` (`refactor(frontend): replace configure routes`).
- Product tree: `b8dcec1e648b7afef8b896de3f2b0bdbd4cc18e8`.
- Branch: `codex/v201-configure-shims`; not pushed.
- Product patch SHA-256: `54ba0c299aba6ed4df84cb0836895f5060774d371c0d80b2998dca81af434e16`.

The product diff is exactly three files: `frontend/src/app/configure/page.tsx`, `frontend/src/app/server/page.tsx`, and `frontend/src/features/shell/left-sidebar-nav.tsx`. Every other tracked path is byte-identical to the base. The earlier Integrations shim and canonical navigation helper are consumed unchanged. Desktop restart, deep-link, performance-inventory, controller, persistence, contract, package, lockfile, and automated-test paths are untouched.

## Replacement contract

Both legacy pages are client shims. They call `router.replace` from `useMountSubscription` and render `null`, so the legacy route does not remain in browser history or render an obsolete surface.

For `/configure`, a recognized non-overview fragment (`rig`, `models`, `integrations`, or `server`) wins. Otherwise a recognized `section` query is used. An overview, missing value, or unknown value resolves to Models.

| Selected legacy section | Canonical destination                            | Preserved state                                                                                                                                   |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| default or `overview`   | `/models`                                        | none                                                                                                                                              |
| `models`                | `/models`                                        | only `new=1` and a `tab` value of `picks`, `get`, `serves`, or `downloads`, serialized in `new`, then `tab` order                                 |
| `integrations`          | `/settings?integration=<validated>#integrations` | only the `integration` query through `integrationSettingsHref`; a Configure fragment such as `#skills` is not reinterpreted as an integration tab |
| `rig` or `server`       | `/settings#system`                               | none                                                                                                                                              |
| unknown                 | `/models`                                        | none                                                                                                                                              |

The standalone `/server` route always replaces itself with `/settings#system`. The sidebar no longer advertises Configure; its now-unused icon import and inherited source comment are removed. All three touched product files contain zero source comments.

## Focused validation

- The normal product commit hook passed staged ESLint and Prettier, followed by the complete frontend TypeScript check.
- Exact-product focused Prettier, ESLint, TypeScript, `git diff --check`, changed-path, and source-comment checks passed.
- A real Next.js 16.2.12 development surface at the exact product bytes was driven through a named, disposable browser session. The authoritative 13-case matrix covered default, overview, unknown state, both precedence directions, recognized and invalid Models state, Integrations default and selected tabs, rig, server fragment, and the standalone Server route. Every final URL matched the contract.
- The history probe seeded `/models?tab=get`, navigated with `location.assign` to legacy Server Configure, and observed `/settings#system` at one additional history entry. Back returned directly to `/models?tab=get`, and Forward returned to `/settings#system`; no legacy Configure entry remained.
- The browser session was closed and the local server was stopped. No settings control, model, recipe, runtime, integration, or persisted rig was changed through the browser.
- No automated test was added, restored, modified, or run.

Fresh worktrees do not inherit dependency trees. Initial focused TypeScript attempts failed only while the controller dependency tree was absent; the accepted rerun used the canonical pinned dependency installation and passed without source changes. Turbopack also rejects dependency symlinks that point outside its filesystem root, so the browser probe used disposable clone-on-write copies of the same installed dependency trees. These setup diagnostics are retained outside the accepted manifest.

Stage 4 intentionally leaves the obsolete Configure component graph unreferenced for the immediately following deletion stage. The root aggregate gate and dead-code gate were therefore not run in this isolated lane; the integration owner must run them after composing the reviewed deletion commit.

## Scoped size

Git records 63 insertions and 14 deletions, net **+49 raw lines**, across the three product files. Local cloc 2.10 (`3fb66a1c22928338fef082637b8d6ee21c5ba25eb9d8738651e861e7a72b4948`) counted 107 code / 1 comment lines at the base and 149 code / 0 comment lines at the product commit: net **+42 scoped production code lines** and removal of the last source comment.

This temporary compatibility growth is not frozen-program LOC credit. The integration owner must recompute the pinned frozen manifest after composing the deletion stage that removes the obsolete Configure and duplicate Server/OpenAPI surfaces.

## Durable evidence

Evidence directory: `/Users/sero/projects/vllm-studio-v201-evidence/configure-stage4-shims-20260815/`.

| Accepted artifact             | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `accepted-manifest.sha256`    | `795e7cb2303cc8228ecb25d29959f7adcd23366f4af45221e66bf4b7c15dbe96` |
| `browser-route-matrix-r3.log` | `a4514c2c4c013ef910e5d98c3f1081b80c601134155214abaa229b3d9b2829a4` |
| `browser-history-probe.log`   | `98ce959ce6f50b1997b11e15433f01e2d650d1d8ee44305714d9e2798d25a16e` |
| `prettier-check.log`          | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `eslint-focused.log`          | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `frontend-typecheck-r3.log`   | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `diff-check.log`              | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `product-files.log`           | `22d86261168378adda0099055434dbd228967b42ae1834a291d905479d2cc637` |
| `source-comments.log`         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `cloc-2.10-base.csv`          | `fdcc1f010adc281c2d7378de9924582fe23d5964fa2284e6b48f79edfacf13b3` |
| `cloc-2.10-product.csv`       | `c53b0af4c68a0b8c0603d998750e72ab3ac2d9bbc8d15af498b5b875c41148e9` |

`superseded/browser-route-matrix.log` and `superseded/browser-route-matrix-r2.log` are explicitly excluded from acceptance: a shell-pipeline binding error captured only the last matrix row. The complete R3 artifact above is authoritative. Dependency-path and setup failures live under `diagnostics/` and are likewise excluded from the accepted manifest.

## Remaining acceptance

- Compose the independently reviewed Configure and duplicate Server/OpenAPI deletion so the orphan graph disappears, then run the root-owned aggregate `npm run check`.
- Re-run the compatibility matrix on the exact composed production build, then exercise direct launch, reload, Back/Forward, narrow navigation, restart, and installed desktop behavior.
- Preserve and prove the persisted-rigs database boundary on a disposable copy before any later rigs API deprecation.
- Recompute frozen product LOC, push the accepted integration head, pass hosted CI, and complete independent exact-diff review at that head.
