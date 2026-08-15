# PR #396 Low-Drift Product Simplifications

This ledger records a narrow, hunk-reviewed port from PR #396 onto the accepted v2.0.1 convergence base. It is not a disposition for the rest of #396 and does not make its controller, runtime, test-deletion, or broader frontend changes acceptable.

## Frozen input

- Accepted base: `a5813610f6490f560b54f58cc61a18b5bed5ca75`.
- Final product tip before this ledger: `c4cfaf526b992c601a46995041bd4c5be6d08cff`.
- Source branch: PR #396, `codex/codebase-halving-20260811`.
- Port rule: retain current visible behavior, move ownership without adding a second state owner, and omit any slice whose dependency or error semantics cannot be preserved inside the assigned paths.
- No automated tests were added, restored, or run. No app was packaged or installed.

## Port disposition

| Surface                      | Source commit                              | Result                                                                                                  |
| ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| llama.cpp option catalog     | `fc375918fbface61dcb3c9c5a98fdd778e91bcd6` | Ported; final blob matches the source commit.                                                           |
| MLX option catalog           | `4dba485623e3bed24a6634470928a639a8d1ca97` | Ported; final blob matches the source commit.                                                           |
| Logs page/view ownership     | `5d7430379477e4800ffe014e4ede0c196e415fe3` | Ported; both final blobs match the source commit.                                                       |
| Setup page/view ownership    | `d70310a55d8ad96dcd0abded817b43cb4d7c0586` | Ported; owned final blobs match the source commit.                                                      |
| Settings page/view ownership | `6675f049d1685a25025cf3e15e523c13f1b11de5` | Ported; both final blobs match the source commit.                                                       |
| Model-library ownership      | `99873d3337664a6a9a051b7462b417cd9a6e45ae` | Ported with the two newer base details preserved: the removed `eyebrow` and the scrim/backdrop overlay. |
| Dashboard layout ownership   | `2001b6d92a5af6dc6c68e2702d087a829d1a5521` | Ported with the newer fixed-height, overscroll-contained log strip preserved byte-for-byte.             |
| Composer prop grouping       | `580eefdedfebed8aad2014cbcaa2ed65b84daddd` | Ported; both final blobs match the source commit.                                                       |
| Automation request boundary  | `a7e051dc800eeff060637c56d2234895691d0adb` | Adapted locally so the schema owns decoding while existing fetch and error behavior remains exact.      |

The automation source slice is not self-contained. It imports `frontend/src/lib/api/request-json.ts`, which was introduced by `7075ba7eb7a2322ef693c7d0856f28fc3078207a` and does not exist at the accepted base. Adding that helper is outside this lane's path ownership. The source hunk also changes the fallback from `Request failed with HTTP <status>` to `Automation request failed (<status>)`. The adapted port therefore keeps the local fetch/error boundary and changes only its decoder parameter from a callback to the governing Effect Schema. A 10-scenario probe confirms identical values, requests, and errors.

## Product paths

The product diff against the accepted base is exactly these 17 paths:

```text
frontend/src/app/logs/page.tsx
frontend/src/app/settings/page.tsx
frontend/src/app/setup/page.tsx
frontend/src/features/agent/ui/agent-composer-frame.tsx
frontend/src/features/agent/ui/chat-pane.tsx
frontend/src/features/agent/automations/automation-api.ts
frontend/src/features/dashboard/control-panel/control-panel.tsx
frontend/src/features/dashboard/dashboard-page.tsx
frontend/src/features/dashboard/layout/dashboard-layout.tsx (deleted)
frontend/src/features/dashboard/layout/dashboard-types.ts (deleted)
frontend/src/features/logs/logs-view.tsx
frontend/src/features/recipes/llamacpp-options.ts
frontend/src/features/recipes/mlx-options.ts
frontend/src/features/recipes/recipes-content/recipes-content-view.tsx
frontend/src/features/recipes/recipes-content/recipes-content.tsx
frontend/src/features/settings/settings-view.tsx
frontend/src/features/setup/setup-view/setup-view.tsx
```

No controller, service, runtime, shared-contract, package manifest, lockfile, test, fixture, or E2E path changed. A zero-context diff scan found no added source-comment line, and every touched product file is comment-free at the final product tip.

## Behavior-preservation probes

- A TypeScript-transpile probe evaluated the pre-port object catalogs and the tuple-derived catalogs. All exported arrays were JSON-identical:
  - `LLAMACPP_OPTIONS`: 69 rows, SHA-256 `dd42e9c8bc6d76272835e72fb8ddc0781798bacc19422e64e594b4f63182c473`.
  - `LLAMACPP_OPTION_KEYS`: 69 rows, SHA-256 `06e23b4a8a454b9ff2aecfca5be04f8db66df9e1c75d134541152fbc1deb9ac5`.
  - `MLX_OPTIONS`: 9 rows, SHA-256 `1b216424c6e55f4473c13d699ad16c01fb4d887caacad8a8b8371d9d2d2aad45`.
  - `MLX_OPTION_KEYS`: 9 rows, SHA-256 `c8aabb522deabd6ce89f76a50e0a5079d961f7ab01e124489668134e8ed945fb`.
  - Persistent probe transcript: `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/catalog-parity.log`, SHA-256 `b5f74efe63ad6c74e5c8c85f4fe3b2da65ca5bef8742f600c9a8de25bcb23a1e`, ending `CATALOG_PARITY=PASS` and `CATALOG_PROBE_EXIT=0`.
- Blob comparison against the eight direct-port source commits found 14 exact paths. The three intentional adaptations are `recipes-content-view.tsx`, `control-panel.tsx`, and `automation-api.ts`, limited to the accepted-base details and exact error behavior listed above.
- Static ownership scan confirms the App Router pages now render parameterless `LogsView`, `SetupView`, and `SettingsView`; `RecipesContent` renders only `RecipesContentView`; and no `DashboardLayout` or `DashboardLayoutProps` reference remains.
- The moved page/view hooks have the intended current owners: `LogsView` owns the logs-page call while `ServerView` retains its independent `useLogs` call; `useSetup` is in `SetupView`, `useSettings` in `SettingsView`, `useRecipesContentModel` in `RecipesContentView`, and `useDashboardData` in `DashboardPage` with its return type reused by `ControlPanel`.
- The ownership moves intentionally stop the hidden settings page from mounting `useSetup()` when the setup wizard is not visible. That unmount aborts its client-side lifecycle/runtime-job polling and its download polling, which runs every two seconds only while a download is active and every 15 seconds otherwise; server-side jobs continue independently and wizard progress remains in `setup-progress` storage. The moves also rebuild the recipes table object on each view render instead of memoizing it in the pass-through parent; its consumers are not memoized and each memoized row still receives the same scalar props. The guarded delete-confirm branch makes its non-null assertion reachable only when the value exists.
- Composer grouping preserves the existing values and callbacks under `actions`, `attachments`, `context`, `drag`, `goal`, `mention`, `statusBar`, and `textarea`. The previously declared but unused frame-level queue props and local `queueExpanded` state are gone; queued-message behavior remains owned by `SessionProjectDrawer`.
- The direct ports remove four MLX documentation-comment lines, the two-line setup-view ownership comment, and three structural JSX comments. The final policy cleanup additionally removes 12 inherited comment lines from `chat-pane.tsx` and the two-line fixed-log-tail JSX comment from `control-panel.tsx`; every touched product file is now source-comment-free. JSX comment removal counts as code rather than comments in cloc. The MLX tuple data and one-to-one option-key mapping remain proven by the catalog equivalence probe. Its new value import reaches the llama.cpp option module, which was already in the same runtime graph through `engine-capabilities.ts`.
- An Effect runtime probe compared the accepted-base automation boundary with the adapted boundary across all six exported operations, URL/body/header capture, an API error string, malformed error JSON, schema rejection, and a non-`Error` transport failure. All 10 scenarios were identical; normalized result SHA-256 `c14baba1a31ae438add73c6f13250e9d97a532813704cb44ee096b0a61807e7b`. Persistent transcript: `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/automation-parity.log`, SHA-256 `fc7974ce4dfe85f8a8d7a27426b6139700e59556f2aa33483c176c01da5b35d3`, ending `AUTOMATION_PARITY=PASS` and `AUTOMATION_PROBE_EXIT=0`.
- Earlier `/tmp` probe, check, screenshot, and review artifacts were purged by macOS during shared-disk pressure and are historical only. Every result used for final acceptance below was regenerated under `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/`; no missing temporary artifact is treated as current proof.

## Frozen LOC result

Method: the pinned cloc 2.06 pipeline in `docs/v201-program/baselines/method.md`, including the identical tracked non-symlink list, scope, extension, and test/generated exclusion filters. Tool SHA-256 was rechecked as `ed9fbdd081a2ceb933ea490b3c1cfacc87d3898ae2650d0d6756439695a836c8`.

| Ref                       | cloc files | blank | comment | product code |
| ------------------------- | ---------: | ----: | ------: | -----------: |
| accepted base `a5813610f` |        791 | 8,357 |   4,166 |      104,378 |
| product tip `c4cfaf526`   |        789 | 8,343 |   4,147 |      103,524 |
| reduction                 |         -2 |   -14 |     -19 |     **-854** |

The reduction is entirely TypeScript product code: 98,903 to 98,049. Documentation is outside the frozen product scope. The persistent cloc CSV is `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/cloc-final.csv`, SHA-256 `19336994073a1a774465b20b7d8af90f9f5a37f56f1ecd7dae356ea21eb62907`.

## Gates and remaining acceptance

- Exact root `npm run check` completed with observed exit code 0 at final product tip `c4cfaf526` using in-tree copy-on-write dependency clones. All six top-level stages completed: automation layout, shared contracts, structure, frontend quality/production build and standalone assertion, controller quality/standards, and agent-runtime production build. Frontend lint retained one pre-existing out-of-scope complexity warning and zero errors; both duplicate scans found zero clones; the controller standards audit returned zero errors/warnings; Next generated 20/20 static pages. Persistent transcript: `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/root-npm-check.log`, SHA-256 `d0e2b61723f622eee13e0e5d0bcc4f8fb931d48a59b448cffca4b7a64cb48d1c`, ending `NPM_CHECK_EXIT=0`.
- The production standalone output from that check was served against isolated data and HOME directories on ports `32174`/`32175` and inspected with named browser session `pr396-low-drift-20260815`. The retained WebM is `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/browser-preview.webm`, SHA-256 `bb6446130213d467f94ac8c0723feadaea6432bfaaee087fa25a755ac71802f1`. The interaction ledger is `browser-preview.md` beside it, SHA-256 `fb37ba08f273403a56c2816f7d0b11beefbcf55835d333ae98845b76bee7d52d`. No package or installed app was involved.
- Setup rendered Station step 1, the editable weights location and Continue action, plus the expected unreachable-controller alert (`screenshots/setup.png`, SHA-256 `5e5ae565a1adbd7affbc6a54c72b986de79cc3fe658d161b10ee4784a5f5a59e`). The disposable setup state was then skipped only to inspect later surfaces.
- Logs rendered its isolated empty-state view and filter (`screenshots/logs.png`, SHA-256 `ebc94c0f599a78bc006806cf7dc353a04d1aec99b9ed06b2381f9ecf985c4184`). No real controller log session was present, so selected-session controls were not claimed in this rerun.
- Settings rendered the General section, version, controller/API fields, connection controls, and settings navigation (`screenshots/settings.png`, SHA-256 `21ecc3a89da75bcb4077994ff1f16fc3f242660a208f5cf1e9f66d9e19759a22`).
- `/recipes` redirected to Models; Picks and Serves mounted, and New Serve opened without saving. The engine tab switched from vLLM to MLX and the modal then closed (`screenshots/models-picks.png`, SHA-256 `dfd1a6350c84fc36462624098429bf0940b80380100e0254e2d7deed309ce5d8`; `screenshots/serve-modal-vllm.png`, SHA-256 `e37a0af9f9433d5ae1a192a3fd0acac379e7065292b5170294f5d91e395cf6bc`; `screenshots/serve-modal-mlx.png`, SHA-256 `eb51c15eeab64d159e4bbb0864891bcf901716b3a6b4ad95b84f034a5e4e0728`). The accepted scrim/backdrop remained visible.
- Dashboard rendered standby status, metrics, GPU region, and controller-log strip (`screenshots/dashboard.png`, SHA-256 `d5062b00a3178b589b1465a7078731e35b2b0fa6d021fbce040b709ace781137`). The isolated run had no controller or GPU telemetry, so live data is not claimed.
- Agent rendered the empty-session composer; a disposable draft enabled Send and clearing it disabled Send without submitting (`screenshots/agent-composer-cleared.png`, SHA-256 `32fafe3e632c3a17cf8d629943978cde94793df2b644dd6cad29394277384415`).
- Automations rendered its empty list, search, tabs, and creation actions; a clean reload produced the same state with no page error (`screenshots/automations.png`, SHA-256 `5cfc6cba1780b57ed9c6d9dc935ea4c39b13ec3430571153a400a37b433db7bf`).
- The screenshot paths above are relative to `/Users/sero/projects/vllm-studio-v201-evidence/pr396-low-drift-20260815/`. They corroborate rendered end states; the WebM and interaction ledger establish typing/clearing, tab switching, modal open/close, and clean reload.
- The preview performed no Save, Send, Use, Install, Add, Test, model launch, controller mutation, package install, deletion, or automation-create action. Its isolated frontend/runtime processes were stopped and both ports were proven closed.
- Remaining gap: this slice is not installed-app acceptance and does not by itself prove the rest of PR #396 safe.
