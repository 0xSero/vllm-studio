# Browser runtime operation lifecycle — PR #373 composition evidence

Production-only semantic composition on branch `codex/v201-pr373-runtime-final-20260815`. The lane started from accepted PR #367 product head `81258fd3931955426432530b97872fcb6f25727d`, then imported its superseding all-terminal-dot policy fix and final evidence. Evidence was captured 2026-08-15 EDT. This branch is unpushed; nothing here proves the installed app, visible browser panel, combined CI, or release.

## Canonical forward remediation (C)

The consolidation branch was independently found at remote head `00210ba8ab17a7a28d38b48c52f6f68c0683f8f2` after an unauthorized writer pushed two post-evidence product commits. History was preserved. `911db83e0` forward-reverts the parser commit and restores Reader link/Markdown semantics; `1009d435d` forward-reverts the active-abort shortcut and restores mandatory generation invalidation and recovery. No reset, force push, amend, or commit removal was used.

At `1009d435d`, the six composed runtime file blobs are byte-identical to validated safe product head `ced8a7b01`. The retained equivalence transcript is `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/safe-blob-equivalence.log`, SHA-256 `e6b854eeb618fd7826bfc293e33b3d4d43ed7d2353248b1e6b1c2e0a03c9e474`. A disposable Reader request returned `Read [the docs](https://example.com/docs).`; its transcript SHA-256 is `dfc0db6c62d3943b291a013bf360b9403a70dfa5c435e9273515144a10207041`.

The exact root `npm run check` at repaired product head `1009d435d` passed frontend production compilation and standalone assembly, controller gates, and agent-runtime build with `FULL_CHECK_EXIT=0`. Transcript: `/Users/sero/projects/vllm-studio-v201-evidence/canonical-remediation-20260815/root-npm-check-r2.log`, SHA-256 `0032ace3cd35a390d6baf285fcb5caf4251d8979ee2e98bfe4b3196d3b2e65e2`. The retained first attempt stopped before Next compilation only because Bun was absent from the non-login shell PATH; the unchanged product passed after `/Users/sero/.bun/bin` was explicitly supplied.

## Provenance (C)

| item | value |
|---|---|
| Source PR | #373, `[Bug] Unify the visible browser pane and bound browser operation lifecycle` |
| PR base | `a765eb27bca4baffabc6dc84c553fc6d8be5590d` (`dev`) |
| PR head | `511ee85f94e4eac843e5c33f62e192f474a7d939` |
| Reviewed source commits | `4f58b3f5c` host lifecycle, `936e68a06` HTTP coordination, `511ee85f9` retryable frame recovery |
| Source author | `fettpl <38704082+fettpl@users.noreply.github.com>` |
| Restricted six-file source patch ID | `2d5b30c802e982c24250efaddfa2c496f6aa5a8c` |
| Composition base | `81258fd3931955426432530b97872fcb6f25727d` |
| Lifecycle composition | `06479c2f48749a53836a6c262f59bf2693596e0a` |
| HTTP/reader composition | `4f77650175d86bce96960d0cd334fe6a56fb4690` |
| Final PR #367 policy import | source `0843f6f3eb87026739a45433f77ebeedb038175f`, local `5cf61d2eb` |
| Final PR #367 evidence import | source `a54fa422d`, `2cf567e56`; local `b483a28b1`, `ad39e056e` |
| Unattributed active-abort commit | `febbdf6131807e0cb264ff1bf276c9052bc94a0f` |
| Adjudicated revert | `ced8a7b01cd6d807aa8cd74112814d8693cd5f04` |
| Validated product head | `ced8a7b01cd6d807aa8cd74112814d8693cd5f04` |

The raw PR #373 patch was not cherry-picked. It would erase the DNS-pinned public/loopback proxy boundary and carried lifecycle defects: recovery shorter than browser launch, terminal stop reused as recovery, reader and fallback mode loss, and late work capable of publishing stale state. The two composition commits manually preserve the accepted #367 proxy, destination-policy, setup-failure, cleanup-failure, and mode semantics. Both carry the source author's co-author trailer. No PR #373 test or frontend file was copied, restored, modified, or run.

## Production scope and contract (C)

| path | purpose |
|---|---|
| `services/agent-runtime/src/browser-host/browser-operation-coordinator.ts` | FIFO queue, enqueue deadlines, request aborts, active generations, bounded recovery, sticky recovery failure |
| `services/agent-runtime/src/browser-host/browser-host.ts` | page generation fence, late-page closure, delayed active-mode publication, retryable invalidate, terminal stop, final navigation reclassification |
| `services/agent-runtime/src/browser-host/playwright.ts` | active/pending context generations, clean retryable invalidation, terminal stop, sticky setup/cleanup failures, complete proxy ownership |
| `services/agent-runtime/src/browser-host/reader.ts` | public/loopback mode retention and abort propagation across DNS, requests, and redirects |
| `services/agent-runtime/src/http/browser-handlers.ts` | one queue for frame/input/state/verb/viewport, request-signal forwarding, active assertions before shared-state writes, classified nullable fallback state |
| `services/agent-runtime/src/http/app.ts` | request forwarding for frame and state routes while retaining newer transcription and session-list routes |

The coordinator starts each deadline at enqueue. Queued timeout or abort returns without running the operation or recovery. Active timeout or abort invalidates its generation, signals the operation, completes `browserHost.invalidate()`, and rejects before the permit is released. Old queued work cannot run after recovery; fresh-generation work can. Recovery has 30 seconds, exceeding the 15-second browser launch timeout, while a verb has 25 seconds to cover launch plus the 8-second navigation budget. Recovery failure poisons the queue.

`BrowserHost.invalidate()` closes owned pages, advances the host generation, clears active state, and calls retryable manager invalidation. `stop()` is separate and terminal. The manager advances its generation before waiting for its semaphore, fences active or late launches, closes a stale launched context, owns both pending and established proxies, and clears all resources on invalidation. Clean spontaneous context closure and clean explicit invalidation can relaunch. Route setup, proxy setup, mode-transition cleanup, context/process cleanup, and recovery cleanup failures stay sticky and fail closed.

Reader fallback keeps the `(rawUrl, mode = "public", signal?)` boundary across every hop. Browser-pane fallback can read public or loopback destinations according to the classified navigation; direct `/api/agent/browser/fetch` remains explicitly public-only. Every state write follows `assertActive()`. Successful host, reader, and frame URLs are reclassified into `BrowserNavigation | null`, including final redirects and the shared all-terminal-dot hostname normalization.

The six touched production files are comment-free. The inherited handler comments had already been removed at the accepted #367 base, and this composition adds none. The final source and test-scope scans remain part of the sealing gate below.

## Deterministic lifecycle and fallback probe (C)

Command from `services/agent-runtime`: `LOCAL_STUDIO_CHROME_PATH=/nonexistent/local-studio-probe-browser /Users/sero/.bun/bin/bun /Users/sero/projects/vllm-studio-v201-evidence/pr373-runtime-20260815/lifecycle-probe.ts`.

| item | SHA-256 |
|---|---|
| retained script | `e9ee650dfe552e1e249b897f883bf54ccbd227c0cb7eda0946b6a148c85b5e90` |
| final transcript | `50c980de1e62b70e937b57f5566de844ab36b7128a546e5f35c1952421aa24d9` |

The external script used only fake contexts/proxies, fake DNS/request hooks, and request-local abort controllers. It did not use a user browser profile, credentials, private content, or automated repository test path.

| scenario | final result |
|---|---|
| FIFO operations | exact order `first-start`, `first-end`, `second` |
| queued timeout | returned in 40 ms; zero operation effects; zero recovery |
| queued request abort | zero operation effects; zero recovery |
| active timeout | one recovery; late `assertActive()` prevented the stale write |
| stale queued generation | aborted with zero effects; a fresh operation then succeeded |
| active request abort | one recovery; caller received `aborted` |
| recovery failure | first and subsequent operations returned sticky `recovery-failed` |
| clean manager invalidation | active context and both proxies closed; fresh context/proxies launched |
| spontaneous clean context close | manager stayed available and relaunched without recreating live proxies |
| late launch after invalidation | late context closed, stale ensure rejected, proxies closed, fresh ensure succeeded |
| setup failure | original route error stayed identity-sticky; manager became unavailable |
| cleanup failure | context and browser close failures aggregated and stayed sticky |
| `localhost.` / `localhost..` reader mode | both normalized once to `localhost`, succeeded only in loopback mode, and stayed blocked in public mode |
| no-Chromium pane fallback | multi-dot loopback navigate plus remembered get-text succeeded with normalized URL `http://localhost/` |
| direct fetch | multi-dot loopback URL returned HTTP 400 without issuing a request |
| public redirect to loopback | rejected after the first request; no second request |
| aborted reader request | rejected as `Browser fetch aborted`; no shared fallback state was published |

The first retained attempt only recorded that `bun` was outside the non-login shell PATH. The second produced the expected result and then exposed a disposable-harness-only unhandled rejection during cleanup; the harness was corrected without product changes. Pre-multi-dot and pre-restoration successful transcripts remain retained for provenance.

At 03:07:26 EDT an unattributed edit appeared in the owned worktree that would skip recovery for active request aborts. It was restored, reappeared at 03:10:09, and was committed at 03:10:40 as `febbdf6131807e0cb264ff1bf276c9052bc94a0f`. The exact diff is retained at `/Users/sero/projects/vllm-studio-v201-evidence/pr373-runtime-20260815/unowned-active-abort.patch`, SHA-256 `29ecc1975c68b68ba6be1841c182c9278c449eb2492679f4f2b9f276e19c5e15`. Its coordinator blob was `69beb12e141045355715a9f02a4659569f8a2beb`; the accepted blob before it was `b430b564a4e79293731df76fb8634decacb3924d`.

Independent composition audit classified that change P1/high: an abandoned Playwright or proxy operation could continue after the semaphore was released while queued work entered the same generation. The conventional revert `ced8a7b01cd6d807aa8cd74112814d8693cd5f04` preserved commit provenance and restored the exact accepted blob `b430b564a4e79293731df76fb8634decacb3924d`. The final deterministic probe above ran after that adjudication and proved one recovery on active abort, one recovery on active timeout, and zero stale writes. Attribution of the original writer was unresolved when these gates ran; the committed production tree was clean and the coordinator matched the accepted blob exactly.

## Isolated real-Chromium probe (C)

Command: `TMPDIR=<persistent disposable profile root> LOCAL_STUDIO_CHROME_PATH=<Playwright Chromium 1228> /Users/sero/.bun/bin/bun /Users/sero/projects/vllm-studio-v201-evidence/pr373-runtime-20260815/chromium-probe.ts`.

| item | SHA-256 |
|---|---|
| retained script | `2101bd2611b3a8c373c7b6d81fd0998582d07ebc90e42e9fb6a6b4b381153930` |
| passing transcript | `616906d601095e352d4137be74ab1661856ad5d5ddb137f4708c2224991478b2` |
| cleanup transcript | `e0d1096767a14cccdc7c2b80af4d6443c69682b1f0f83f98e17e9b671f332fdb` |
| residue transcript | `b72cb0cafa0231252f7cca4dc1cb544d1650b3e196459788d40687258895303b` |

Chromium loaded a disposable IPv4 loopback page, survived a spontaneous clean context close through relaunch, switched to `https://example.com/` while closing the old page, timed out one active frame operation and completed exactly one invalidation, relaunched fresh loopback state, and made stop terminal. All output was limited to disposable/public URLs and lifecycle counters.

Two retained diagnostic attempts used `localhost..` against an origin bound only to IPv4. The policy normalized the URL, but Chromium returned an empty page on this host; the passing real-browser run used explicit `127.0.0.1`. The deterministic resolver proof above separately establishes single- and multi-dot classification. This diagnostic does not establish whether the empty real page came from address ordering or another browser/proxy mechanism.

The three exact generated profile roots totalled 33.6 MiB and had no open handles before cleanup. They were moved to macOS Trash, not permanently deleted, and absence from the evidence directory was confirmed. No process whose command referenced those profile roots remained.

## Static gates and exact scope (C)

| gate | outcome |
|---|---|
| `git diff --check` | pass at `ced8a7b01`; no output |
| Babel TypeScript comment scan over six touched product files | pass; `COMMENT_TOKENS=0` |
| automated-test path scan | pass; `TEST_PATHS=0` |
| `cd services/agent-runtime && bun run check` | pass; `AGENT_RUNTIME_CHECK_EXIT=0` |
| root `npm run check` | pass; `FULL_CHECK_EXIT=0` after frontend production build, controller gates, and agent-runtime build |
| dependency/generated-output cleanup | pass; all nine exact lane-generated paths absent |
| worktree state before evidence seal | only this evidence document was untracked |

| transcript | SHA-256 |
|---|---|
| static scope | `8d2b77e61633607672f2886f0da09c5dc9178a62ba23706c7bd838eb14915537` |
| agent-runtime check | `751fc0a9584fcb02e67761557afdb4a3c886c0fc86caa015aeea9c7d7378a0aa` |
| exact root check | `db0e7057b96b106f2a3d15e4cc128d07bedc4a11bf8e3adf8be02f3ee866ddef` |
| generated cleanup | `f6ee41a19e0063a29d499a10dd4f2481536b2bfde59abfa4c97d979eb68e3244` |

The first package wrapper attempt reached a successful build but used zsh's read-only `status` name when recording the exit code; the corrected wrapper produced the passing transcript above. The first two root-check attempts identified missing root-level `effect`, then `fast-check`, in the isolated APFS-cloned dependency scaffold. Adding exact dependency clones from the validated local dependency tree allowed the unchanged product head to pass. The attempt transcripts remain in the external evidence directory. No automated tests were added, restored, or run.

| production path | added | removed | SHA-256 |
|---|---:|---:|---|
| `browser-operation-coordinator.ts` | 192 | 0 | `8c161e09e14f00b51366e10263a0f12fcc169dda563453532c7cfbb53cf8fbd2` |
| `browser-host.ts` | 31 | 10 | `39b359eeb912e6b296c1d5d5b1b93f336bddea28ac75aaa07a7a2fe596f3ad88` |
| `playwright.ts` | 106 | 22 | `c2bf1091ccc65d9712da65fa7c5c0e529723971542f61986c02642e67d74b47d` |
| `reader.ts` | 58 | 12 | `066f4ce8f09b0e43dcdb264a107846d3b4ecc3fa0883c3afac7f312102a768b9` |
| `browser-handlers.ts` | 178 | 62 | `0ea65efe37dc9471a5953f4224e0625c25b8ddd73676d7bef9fad848ee3d460f` |
| `app.ts` | 2 | 2 | `63c5ad4e83ad870ebb74dbd35871a4053186736e70e34368e23d2521ea787c67` |
| imported `network-policy.ts` correction | 1 | 1 | `e27895d93a32fb33881c845498f28adb8b266435ad52a5837459a2dfb2038a22` |

Cleanup permanently removed only this isolated lane's exact generated clones and build outputs: root, controller, frontend, and agent-runtime `node_modules`; frontend `.next`, desktop `dist`, `tsconfig.tsbuildinfo`, and `next-env.d.ts`; and agent-runtime `dist`. The cleanup reclaimed approximately 2 GiB of reported free space. Probe transcripts and scripts remain under `/Users/sero/projects/vllm-studio-v201-evidence/pr373-runtime-20260815/`.

## Remaining proof (P)

- The six-file runtime slice does not include PR #373's frontend frame barrier. Visible panel ordering and rendering remain a separate frontend composition/acceptance row.
- The PR #373 automated tests and unrelated frontend Markdown change were deliberately excluded under repository policy and scope.
- No installed Local Studio Dev app, user-visible browser recording, Windows browser, Linux browser, combined PR CI, merge, or release is proved here.
- The explicit-IPv4 real-browser pass does not close the diagnostic `localhost` dual-stack loading gap described above.
