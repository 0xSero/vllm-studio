# PR #269 and PR #271 small-fix evidence

Date: 2026-08-15

Status: the scoped source fixes and validator follow-up are committed and locally validated in an isolated lane. They are not pushed, included in hosted CI, or accepted on an installed desktop build.

## Provenance and scope

- Isolated lane: `/Users/sero/projects/vllm-studio-v201-small-external`
- Branch: `codex/v201-small-external-20260815`
- Exact convergence base: `370b7aa29175b904fb81537f98748de1c8b03858`
- Exact product tip: `57918fb5889c51240a612ad24e39a100090e1c42`
- PR #269 source branch: `4bb29b450dec356373eeb77fafba1bb912aaec3e`; underlying product proposal `ea5319c78e08f64b015a6f635dd2408c48eddd9d`
- PR #271 source branch: `31df4f460afca9d17f6869c8347218dca71250bd`; underlying notice-placement proposal `4a8f4cdf93fd626aca53583241a40002f02d89ad`

The accepted product stack is:

1. `45a15686268512a09e2dd960d05f8ba469156374` — `fix(ui): keep workspace notices clear of composer`
2. `cff2249b9525853d648d03b24ca9f71bb82fd434` — `fix(agent-runtime): preserve matching controller credentials`
3. `57918fb5889c51240a612ad24e39a100090e1c42` — `fix(agent-runtime): keep inherited controller keys live`

The two source-derived commits preserve the underlying proposal-commit author, `tabrobotics <tabrobotics@gmail.com>`; the external PR branches are owned by Dixith-dev. The validator follow-up is a local correction. This is a current-tree adaptation, not a wholesale merge: the source PR test changes were excluded.

The exact production scope is two files. `frontend/src/features/agent/ui/agent-workspace-shell.tsx` moves error and setup notices from the bottom composer overlay to a toolbar-relative top position, raises their layer, and exposes `data-workspace-notices`. `services/agent-runtime/src/pi-runtime-models.ts` lets a keyless requested controller inherit the saved Settings credential only when protocol, effective port, path, and normalized loopback host identity match. An explicit request key remains authoritative, and unrelated controllers remain keyless.

## Validator correction

Independent review initially returned HOLD at `cff2249b9`. That implementation used the saved Settings key for a matching live request as intended, but then persisted the merged live controller set. The inherited key therefore became an explicit value in `controllers.json`; a later Settings-key rotation could leave the runtime using the stale persisted key.

`57918fb58` separates live merging from persistence. The runtime persists a normalized, URL-deduplicated copy of the original requested or previously persisted entries, while applying Settings-key inheritance only to the in-memory set used for the current fetch. Explicit request keys are still persisted. Exact-tip re-review returned GO with no P0, P1, or P2 findings.

## Disposable credential probe

The external manual probe used a unique temporary data root and two loopback model endpoints. It exercised the public agent-model request handler and removed its temporary state and servers afterward.

The accepted R2 result was:

```json
{"status":"pass","inheritedLoopbackCredential":true,"inheritedCredentialPersisted":false,"rotatedCredentialObserved":true,"unrelatedControllerCredential":false,"explicitCredentialPreserved":true,"visibleModels":28}
```

This proves that a keyless `127.0.0.1` request inherited the saved key for the matching `localhost` endpoint; the inherited key was absent from the persisted controller file; a Settings-key rotation was observed on the next refresh; a different loopback endpoint received no credential; an explicit request key overrode Settings and remained persisted; and both controller catalogs remained visible. The 28-model total includes the two probe models plus pre-existing built-in/provider catalog entries, so acceptance targets controller presence and credential behavior rather than an incorrect exact count of two.

Persistent artifacts:

- `/Users/sero/projects/vllm-studio-v201-evidence/small-external-20260815/controller-credential-probe.ts`, SHA-256 `1f7711f972cd942d6d87c935af5ca67dbae33dcf982bf0d09eb397ced6464713`
- `/Users/sero/projects/vllm-studio-v201-evidence/small-external-20260815/controller-credential-probe-r2.log`, SHA-256 `5034bb43135d01ad753225f01d11efea07120933b117eb0e956ebaa21b6bc486`

The earlier log captured the pre-correction behavior and is not acceptance evidence.

## Static and package gates

- The product commits were made through ordinary, unbypassed hooks.
- The frontend slice passed staged Prettier and ESLint processing plus the full frontend TypeScript check.
- `bun run check` from `services/agent-runtime` passed at unchanged exact product tip `57918fb58`. It completed the package build and postbuild, including 180 specifier rewrites.
- The first package-gate attempt stopped before product validation because Bun was absent from `PATH`.
- The second attempt reached the package build but stopped because `tsc` was absent from `PATH`.
- The passing attempt prepended `/Users/sero/.bun/bin` and the lane controller's `node_modules/.bin`; neither setup correction changed product source.
- `git diff --check` is clean.

No retained transcript hash is claimed for the package gate. No automated test file or test code was added, restored, modified, or run. The two touched production files contain no source comments; URL and regular-expression `//` shapes are not comments.

## LOC ledger

The raw two-file product diff from `370b7aa29` through `57918fb58` is 61 additions and 56 deletions:

| path | additions | deletions |
|---|---:|---:|
| `frontend/src/features/agent/ui/agent-workspace-shell.tsx` | 4 | 1 |
| `services/agent-runtime/src/pi-runtime-models.ts` | 57 | 55 |

Frozen cloc 2.06 results for the same two paths are:

| ref | blank | comment | code |
|---|---:|---:|---:|
| base `370b7aa29` | 60 | 26 | 827 |
| product `57918fb58` | 61 | 0 | 857 |
| delta | +1 | -26 | **+30** |

The frontend file adds three code lines. The agent-runtime file adds 27 code lines, removes all 26 pre-existing comment lines in its touched source, and adds one blank line. This slice therefore increases the frozen production-code ledger by 30 lines and does not advance the program's reduction target.

## Explicit remaining gates

The workspace-notice placement has not been exercised in a live browser or visually compared with an active composer, toolbar, popover, or narrow-window state. Neither fix has been rebuilt into or accepted on an installed desktop app. A combined root `npm run check`, canonical-lane integration, push, hosted PR CI, merge, and release remain parent-lane work. This evidence does not claim those surfaces.
