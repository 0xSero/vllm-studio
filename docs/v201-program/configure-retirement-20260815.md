# Configure surface retirement

Date: 2026-08-15

Status: **source-ready for integration; aggregate, browser, and installed acceptance remain open**.

## Provenance

- Exact canonical base: `dcef2b40ed25320c71e5e4bb80c375f5cbf1b707`.
- Companion Stage 4 product: `92bf74a8a7b5782bd7e3a90481a12acf1fa73d6c`, tree `b8dcec1e648b7afef8b896de3f2b0bdbd4cc18e8`.
- Local composition of the same Stage 4 tree: `4ec01964194e3641826f15ed277d3229e542d254`.
- Stage 5 product: `ea2eebd16234ead137c4a0fcea858819b475e020`, tree `9ffb44bb89ebfa2854707b96b4528d73df68c968`.
- Stage 5 parent: `4ec01964194e3641826f15ed277d3229e542d254`.

The Stage 5 commit is meant to follow the reviewed Stage 4 route replacement. The parent lane should integrate Stage 4 first and then cherry-pick only the Stage 5 product and evidence commits from this lane.

## Product scope

The product commit deletes exactly ten retired files:

- `frontend/src/features/configure/configure-navigation.ts`
- `frontend/src/features/configure/configure-page.tsx`
- `frontend/src/features/configure/hardware-art.tsx`
- `frontend/src/features/configure/node-form-modal.tsx`
- `frontend/src/features/configure/rig-node-card.tsx`
- `frontend/src/features/configure/rigs-section.tsx`
- `frontend/src/features/configure/use-configure.ts`
- `frontend/src/app/configure/loading.tsx`
- `frontend/src/features/logs/server-view.tsx`
- `frontend/src/features/logs/openapi-panel.tsx`

It makes only four associated dead-reference cleanups:

- Remove `KeyValueRow` from `frontend/src/ui/list.tsx` and its barrel export.
- Remove `CensoredApiUrl`, its `ReactNode` import, and its attached comment while retaining `useApiUrlCensored`, `setApiUrlCensored`, and `ApiUrlCensorToggle`.
- Remove the stale server-page comment from `frontend/src/features/settings/use-sidebar-status.ts`.

Git records 2 insertions and 1,745 deletions across these 14 product files. Every retained touched product file has zero source comments. No automated test code was added, modified, restored, or run.

## Resulting surface

The companion route replacement keeps `/configure` as a client compatibility route, preserves recognized Models and Integrations state, and replaces history into canonical `/models` or `/settings` destinations. `/server` replaces into `/settings#system`; `/integrations` continues to use the existing Settings integration shim. First-party navigation targets canonical pages directly.

Models, all four Integrations panels, Settings system information, Logs, and the session sidebar remain the surviving product surfaces. Settings → System exposes `/logs` and the same-origin authenticated OpenAPI JSON route `/api/proxy/api/spec`.

The duplicate frontend Server/OpenAPI renderer is intentionally gone. The controller's `/api/docs` and `/api/spec` routes remain byte-identical, but proxied Swagger HTML is not claimed as a supported frontend replacement: its root-relative specification URL and external assets do not satisfy the current frontend proxy and content-security-policy contract. The accepted frontend API-reference surface is `/api/proxy/api/spec`.

## Preservation proof

A 152-blob manifest was captured at `dcef2b40e` and again at `ea2eebd16`. The manifests are byte-identical. They cover:

- the frontend rigs API and wiring;
- the rigs contract, event, route, detection, store, and application context;
- the SQLite `rigs` table implementation;
- every Integrations panel, its Settings mount, helper, and compatibility shim;
- Models and all recipe modules;
- `LogsView`, `useLogs`, and the logs session sidebar;
- the Workbench session sidebar modules;
- Settings operator tools;
- the controller `/api/docs` and `/api/spec` owner;
- the complete Electron desktop tree, including route/performance inventory code.

This stage does not deprecate a rigs API, change a contract or event, migrate or drop a table, alter persistence, edit a controller route, change a desktop route budget, or touch model, integration, logs, or session behavior.

## Focused validation

- Normal product commit hook: PASS. Lint-staged ran ESLint and Prettier on the four retained source files, then the full frontend TypeScript check passed.
- Focused Prettier: PASS.
- Focused ESLint: PASS.
- Full frontend `tsc --noEmit`: PASS.
- Frontend Knip dead-code analysis: PASS.
- `git diff --check`: PASS.
- Retired import/export/name and proxied-Swagger reference scan: PASS, zero matches in product source.
- Touched retained-source comment scan: PASS, zero matches.
- Preservation manifest comparison: PASS, all 152 blobs byte-identical.

The root `npm run check` was deliberately not run in this lane because the parent integration lane owns the serialized aggregate build gate.

## Frozen LOC

Pinned cloc 2.06, SHA-256 `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`, measured the identical 14-file Stage 5 product scope at the base and product commits:

| Ref                 |   Files |    Blank | Comment |       Code |
| ------------------- | ------: | -------: | ------: | ---------: |
| Base `dcef2b40e`    |      14 |      149 |       5 |      1,951 |
| Product `ea2eebd16` |       4 |       42 |       0 |        320 |
| Delta               | **-10** | **-107** |  **-5** | **-1,631** |

The ten whole-file deletions account for 1,598 code lines; the four exact dead-reference cleanups remove another 33. This is the isolated Stage 5 reduction, not the parent branch's aggregate product ledger.

## Durable evidence

External directory: `/Users/sero/projects/vllm-studio-v201-evidence/configure-stage5-retirement-20260815/`

| Artifact                                       | SHA-256                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `deleted-source-sha256-base-dcef2b40e.log`     | `16a6498ae20dc42e54865c2be54ab6a936f41a26b87ada05360692f51efbe4fe` |
| `cloc-base-dcef2b40e.csv`                      | `e88b7ba3da22f9f929aa2705fe8009636d0a2ddefa3422c639abb9324241cec9` |
| `cloc-product-ea2eebd16.csv`                   | `eda41173cf4e807488d7686ee8a5fb30b7e5498b804b4e6d498c92839ad8168e` |
| `prettier-product.log`                         | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `eslint-product.log`                           | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `frontend-typecheck.log`                       | `18f20b008a6922ef78a8750c2110537568104991928628d334eba0dcbcca01d0` |
| `frontend-knip.log`                            | `71d9b57b7a34bddcdd9f28d6393b4d42b8ed1fe02720d2f8b76b25310cc1045e` |
| `product-comment-scan.log`                     | `ff06fdae55acaf74845f87dd813b604a16c8dfe67f1b534fc56e7f6396f5c1fe` |
| `retired-reference-scan-ea2eebd16.log`         | `7ca90ac826d1be73f0dad73609c31c1d3152692293a350f6249c3e228f46cefe` |
| `preserved-blobs-base-dcef2b40e.log`           | `33b110e785e0d0a8023008eb9327dda4cd4ea525347dd8ae90b7f5f80abea5b8` |
| `preserved-blobs-product-ea2eebd16.log`        | `33b110e785e0d0a8023008eb9327dda4cd4ea525347dd8ae90b7f5f80abea5b8` |
| `preservation-commit-check.log`                | `b16fae3aa94b124c84cb023ce9850857f8526c0e01bc2b79426db1a2e0500be8` |
| `preserved-boundary-source-scan-ea2eebd16.log` | `439590cfc8d3b959612f6e3e97ef5765554f89b00270a55ae215fecc9b55d7b4` |
| `product-name-status-ea2eebd16.log`            | `451e06bfbd37321627747b23f848b12b1d85676eac075f79bb4b6361ab7cd0be` |
| `product-commit-ea2eebd16.log`                 | `502ae7a8005d2a463a060c3ff6a7e394aedaead35c4b7f8db73d96f4f7d8b75a` |

## Remaining acceptance

The product commit is not pushed and has no hosted CI. It has not passed the parent aggregate repository check, been built or installed, or completed the live route matrix for direct navigation, reload, Back/Forward, restart, narrow width, authenticated controller access, copied rigs-data preservation, or rollback. Independent review and parent-led aggregate frozen LOC remain required before the Configure retirement or GOAL row 2.4 can be accepted.
