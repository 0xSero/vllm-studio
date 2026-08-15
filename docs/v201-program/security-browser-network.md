# Browser network pinning — PR #367 port evidence

Production-only security slice on branch `codex/v201-security-browser-network-20260814`, exact convergence base `a5813610f6490f560b54f58cc61a18b5bed5ca75`. This lane ports the unique browser destination-policy behavior from PR #367, excludes its test file, and closes one audit gap in the source PR by classifying `192.88.99.0/24` as non-global. Evidence captured 2026-08-14 EDT; nothing here upgrades a `GOAL.md` row or proves the installed app.

## 1. Provenance (C)

| item | value |
|---|---|
| PR | #367, `[Security] Enforce DNS-pinned browser policy across redirects and subresources` |
| PR base | `a765eb27bca4baffabc6dc84c553fc6d8be5590d` (`dev`) |
| PR head | `0cd8dbf1b6157d6fec55b387c83ccd2712238383` (`fix/235-dns-pinned-browser-policy`) |
| Production source commit | `b92b4cc24491df06c96ef636d98bf4b9275ccb38` `fix(agent): pin browser network destinations` |
| Later production delta included | `56ca0debaac107c630c0f45656a98ad88ba7c4c7` makes the route policy injectable in `PlaywrightManager`; its other changes are tests and were excluded |
| Source author | `fettpl <38704082+fettpl@users.noreply.github.com>` |
| Port commit | `cbd8c7acd60be77350135979e2ccfde06d2e3c83` `fix(agent): pin browser network destinations` |

Port method: the cumulative production diff from PR base to PR head was reviewed and applied only across the six owned production paths. The same paths were unchanged between the PR base and the convergence base. Five output files are byte-identical to the PR head; `network-policy.ts` differs by exactly one allowlist datum, adding `192.88.99.0/24` to the blocked IPv4 ranges. `git diff 0cd8dbf1..cbd8c7acd -- <six paths>` contains only that replacement.

## 2. Exact source scope (C)

| path | delta from convergence base | SHA-256 after port |
|---|---:|---|
| `services/agent-runtime/src/browser-host/browser-host.ts` | +18/−5 | `1554779e25245eb380567e9497f98dbc983cc45f4c9b58d7b5a10bc262303a57` |
| `services/agent-runtime/src/browser-host/network-policy.ts` | new, 76 lines | `cc1f7993bb34365bb25c6acfdeae02d8903d5ae29a47e73b9a5b6796c10f34d8` |
| `services/agent-runtime/src/browser-host/pinning-proxy.ts` | new, 115 lines | `97cbd59d92a0596e1bb100375c6affd6cf67a8801807e2ac9aa82a86e4f8240a` |
| `services/agent-runtime/src/browser-host/playwright.ts` | +126/−29 | `e46a3ee7b6314249b55de0a947e100f736d5c62aa71f5e988e7fd4aca73198c1` |
| `services/agent-runtime/src/browser-host/reader.ts` | +30/−25 | `1a9b554c5fd48c0ae911ae188a4e1586a547ea4486b532a912b23b6b2fc1c5e1` |
| `services/agent-runtime/src/http/browser-handlers.ts` | +14/−14 | `ed7cab9fd4896cf542f91f5b638d09c5e05d78ea02974a1b54268099024c21e3` |

Production total: six files, +379/−73. The PR test path `services/agent-runtime/test/browser-network-policy.test.ts` was not copied, added, restored, modified, or run. `git diff --name-only a5813610f..cbd8c7acd` contains only the six paths above. `git diff --check` is clean and the source diff adds no comments.

## 3. Behavior contract (C)

- Navigation accepts only credential-free HTTP(S) pane URLs. Resolution also supports HTTP(S) and WS(S), retains explicit `public` versus `loopback` modes, and rejects a loopback destination in public mode.
- Every DNS answer must decode to a valid address with a matching family and every answer must have the same permitted class. Mixed public/private answers, scoped IPv6, private/reserved IPv4, non-global IPv6, documentation ranges, 6to4, and `192.88.99.0/24` are rejected.
- The reader resolves every redirect hop through the same policy and connects with a pinned lookup result.
- Chromium uses separate public/loopback persistent contexts and separate loopback-only proxies. HTTP, CONNECT, upgrade, Playwright route, and WebSocket route paths all resolve through the policy. QUIC and non-proxied WebRTC UDP are disabled and the loopback proxy bypass is disabled.
- Proxy forwarding dials the resolved numeric address while preserving the original Host or upgrade authority. Closing is idempotent, destroys tracked sockets, closes listeners, and rejects a resolution that completes after shutdown.
- Switching modes closes owned hosted pages and the previous browser context before publishing the new mode. Setup and transition failures remain sticky and fail closed; abort/stop owns active and pending contexts plus pending and established proxies.

## 4. Disposable network probes (C)

Command: `bun /private/tmp/localstudio-v201-security-browser-network-probe.ts` from `services/agent-runtime`. The script was outside Git, SHA-256 `61922733aa42ef96eb6a2bc502fb08664e43038907b9ead7797270a506ee40bd`, used only ephemeral loopback listeners, and was removed after evidence capture.

| scenario | result |
|---|---|
| public address in public mode | allowed |
| public address in loopback-capable mode | allowed |
| loopback address in public mode | blocked |
| loopback address in loopback-capable mode | allowed |
| `192.168.1.10` in either mode | blocked |
| DNS answer `192.88.99.42` | blocked |
| literal `192.88.99.42` | blocked |
| mixed DNS answers `93.184.216.34` + `127.0.0.1` | blocked |
| global IPv6 `2606:4700:4700::1111` | allowed |
| documentation IPv6 `2001:db8::1` | blocked |
| rebinding: route preflight resolved public, proxy re-resolved loopback | HTTP 403; resolver calls 2; loopback origin accepted TCP count **0** |
| delayed resolve completed after two `close()` calls | close promises identical; origin accepted TCP count **0**; proxy listener refused a new connection |

The rebinding probe started an HTTP origin on `127.0.0.1`, returned `93.184.216.34` on the preflight resolution, then returned `127.0.0.1` when the proxy resolved the same hostname. The policy rejected the second answer before dialing. The delayed-resolution probe held `resolve()` pending, closed the proxy twice, then released a loopback destination; shutdown rejected it without a TCP connection.

## 5. Isolated real-Chromium probe (C)

Command: `TMPDIR=<mktemp directory> bun /private/tmp/localstudio-v201-security-browser-chromium-probe.ts`. Script SHA-256: `13db0bb29c7c02b725ac9a40670c48f59f49f22b5ecb186d47fff0f526c62ad3`. Browser: Playwright Chromium 1228 at `/Users/sero/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.

| surface | result |
|---|---|
| loopback context → disposable `127.0.0.1` origin | HTTP 200; DOM text `isolated-loopback-ok` |
| switch loopback → public | prior page/context closed |
| public context → `https://example.com/` | HTTP 200; title `Example Domain` |
| public context → disposable loopback origin | blocked |
| manager stop | both public and loopback proxy ports refused new connections |

The profile root was a unique `mktemp -d` directory (`/private/tmp/localstudio-v201-browser-profile.9OSyW0`), not a user or product profile. After stop, `lsof +D` found no handles and process inspection found no Chromium residue. The 4.7 MiB profile was deleted and absence was confirmed. Both disposable probe scripts were deleted after this ledger was written; no credentials, user data, or private content were accessed.

## 6. PR #373 / #375 overlap re-check (P)

No behavior from either adjacent PR was ported in this lane.

| PR | immutable head | overlapping production paths | direct apply on this port |
|---|---|---|---|
| #373, unified browser surface | `511ee85f94e4eac843e5c33f62e192f474a7d939` | `browser-host.ts`, `playwright.ts`, `reader.ts`, `browser-handlers.ts` | conflicts in all four |
| #375, browser session isolation | `a08af0f7a38da29061e232d2395b07147ec4351f` | `browser-host.ts`, `playwright.ts`, `browser-handlers.ts` | conflicts in all three |

The check used each PR's exact `a765eb27…` base-to-head production patch piped to `git apply --check --verbose` against `cbd8c7acd`. #373 changes page lifecycle/visibility, browser discovery, reader result metadata, and browser handler surface. #375 substantially replaces page/context ownership with per-session isolation. Both touch the same constructors, navigation/fallback, and lifecycle sites now carrying network modes and proxy cleanup, so they require an explicit semantic composition review rather than a later blind cherry-pick.

## 7. Static validation and cleanup (C)

| gate | outcome |
|---|---|
| `cd services/agent-runtime && bun run check` | pass; TypeScript build and postbuild completed |
| `npm run check` from repository root at `cbd8c7acd` | pass end-to-end: automation, shared contracts, structure, frontend static/production build/standalone assertion, controller, and agent-runtime |
| frontend lint | zero errors; one pre-existing complexity warning in `composer-project-drawer.tsx` |
| `git diff --check` | clean |
| test/comment scope scans | no test path and no added source comment |

The first fresh-worktree aggregate attempts exposed dependency-layout artifacts only: missing root-level Effect resolution with package-only links, then `ERR_FS_CP_EINVAL` when Next standalone traced a whole `frontend/node_modules` symlink back onto itself. Replacing those with APFS copy-on-write dependency directories produced the complete passing run above. After validation, the lane removed its generated `.next`, dependency clones/links, and agent-runtime `dist`; free disk increased from 5.3 GiB to 8.9 GiB at that cleanup point. No tracked source was removed.

## 8. Opus-5 r1 remediation (C)

Claude Opus-5 reviewed exact product tip `cbd8c7acd60be77350135979e2ccfde06d2e3c83` and evidence tip `9b1fc1d256aef632ad1dd7030979691a9ca7caf0`. The retained review transcript is `/tmp/localstudio-v201-security-browser-network-opus-r1.log`, SHA-256 `d9c8e6797c5a69a7c849b63c5f7a210a0f04fa9ac8938c75a42ad9a89ed8e1f0`; verdict: **REVISE**. Remediation is split into `a7ee5fa1792da075c94f1f4341d3a184c982403b` (`fix(agent-runtime): reset browser host cleanly across mode switches`) and `f6db2015c65628062b2941b2801f7b7fd4669ac9` (`fix(agent-runtime): harden browser proxy inputs`).

| finding | disposition at `f6db2015c` |
|---|---|
| M1, close failure leaks context/proxies | fixed: a context-close failure enters the shared abort path; cleanup snapshots and invalidates active/pending context state and both proxies, retries context close, falls back to closing the owning browser process, and retains the original failure unless cleanup also fails |
| M1, closed setup context can publish/reuse | fixed: the launched context is owned as pending before route installation; its close listener is installed immediately; a close during setup rejects, closes both proxies, and stores the sticky failure |
| L1, pooled socket listener duplication | fixed: socket tracking is idempotent by object identity, so a reused socket receives one error listener and one close listener |
| L2, malformed CONNECT authority | fixed: CONNECT requires an explicit valid `host:port` or `[IPv6]:port`, ports 1–65535, and rejects whitespace, userinfo, path/query/fragment, slash, and backslash forms before policy resolution |
| L3, reader WS(S) redirect | fixed: every redirect is re-admitted through the reader's HTTP(S)-only navigation boundary before DNS resolution or request creation |
| L4, stale reader public-only description | fixed: stale source comments were removed; no source comment was added |
| L5, startup listen-error handler remains armed | fixed: the temporary handler is removed on successful listening; the retained listener count is zero |
| L6, dropped hosted pages / early mode publication / `localhost.` classification | fixed: owned pages are closed before clearing; `activeMode` changes only after `ensure()` succeeds; trailing DNS dots are normalized before lexical mode classification |
| L7, diagnostic rejection wrapping | fixed defensively: the semaphore carries a fulfilled success/error envelope, then rethrows the exact original rejection outside Effect; the missing-browser `Error.name` and `Error.message` remain exact |
| L8, two lifetime proxy listeners | accepted tradeoff: both bind only to `127.0.0.1`, enforce the same destination policy for every caller, and are closed centrally on abort/stop; lazy provisioning is deferred until the #373/#375 semantic composition so teardown ownership is changed once |

Spontaneous clean context closure is intentionally retryable: the close listener clears only the active context and mode. Explicit stop, setup failure, transition close failure, proxy creation failure, route-install failure, and cleanup failure remain sticky fail-closed states for the process-global manager. Cleanup failures are aggregated without making stale resources reusable.

Final cumulative production scope from convergence base `a5813610f` remains the same six paths and is +499/−87:

| path | final delta | final SHA-256 |
|---|---:|---|
| `services/agent-runtime/src/browser-host/browser-host.ts` | +30/−7 | `7c7edf8634db814c524062f67fb6efd98235bc0a36749a984b5d16371d4cd3a7` |
| `services/agent-runtime/src/browser-host/network-policy.ts` | +76/−0 | `cc1f7993bb34365bb25c6acfdeae02d8903d5ae29a47e73b9a5b6796c10f34d8` |
| `services/agent-runtime/src/browser-host/pinning-proxy.ts` | +144/−0 | `098110c253136a6fac4f60e6dba8a883325c8737a3f89682451e6fb781bcbfec` |
| `services/agent-runtime/src/browser-host/playwright.ts` | +200/−29 | `4c698d5c83cdd33467f226eecb8ab7e643733dd8cf3f47dbedeef324d5d9c767` |
| `services/agent-runtime/src/browser-host/reader.ts` | +35/−37 | `ecd50e55c28e7f843edbd5fde55dc6dec4eda9fc536e80fa95c414d3d842a9f4` |
| `services/agent-runtime/src/http/browser-handlers.ts` | +14/−14 | `ed7cab9fd4896cf542f91f5b638d09c5e05d78ea02974a1b54268099024c21e3` |

## 9. Remediation probes and gates (C)

The before/after lifecycle probe used fake contexts and proxies only to make cleanup and race ordering deterministic. Before remediation it proved: zero proxy closes after an active context-close rejection; a context closed during route setup was returned and reused; a failed mode switch closed zero owned pages and published `loopback`; malformed `/path` CONNECT reached policy as `https:///path`; and a reader redirect to `ws://` reached a second request. Before-probe script SHA-256: `4cab3ea467ae99ba350b44f92b8d01c8551147c7ed4bb36c40616f80746bcfda`; transcript SHA-256: `0b84f54683f99138aee06c602438c163bf6290e6af4b4ca6155fff043915a87f`.

Post-remediation command: `bun <mktemp>/post-probe.ts`. Script SHA-256: `543653545c8eab4135fbbe6afe7acaf3fbd1252f61497a32dac3913de739669d`; transcript SHA-256: `0c8fd220324721ce957ae12496f2c4ad29ea07ddd8b679c8f5dc0818ae5e08f8`.

| scenario | exact result |
|---|---|
| active context close rejects during mode switch | context close calls 2; browser-process fallback close 1; public and loopback proxy closes 1 each; launch count remains 1; the identical original failure is sticky |
| context closes during route setup | no context returned; launch count remains 1; both proxies close once; identical failure is sticky |
| missing browser diagnostic | exact `Error` message `Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH` |
| failed hosted-page mode transition | owned page closed once; map and active id cleared; `activeMode` stays on the successfully established prior mode |
| `http://localhost./` | normalized and requests loopback mode |
| malformed CONNECT matrix | `/path`, missing port, port 0, port 65536, userinfo, backslash path, and bracketed IPv6 without port: 7/7 HTTP 403 and zero policy calls |
| valid CONNECT matrix | `example.com:443` and `[2001:db8::1]:8443`: 2/2 HTTP 200; canonical authorities were the only policy calls |
| proxy after successful listen | zero retained `error` listeners |
| reader `ws://` redirect | rejected by browser policy after one HTTP request; no second request |
| delayed policy resolution after two closes | close promise identity equal; disposable origin accepted TCP count 0 |

The isolated real-Chromium remediation command was `TMPDIR=<mktemp directory> bun <mktemp>/chromium-probe.ts`. Script SHA-256: `693217cb536fb34807098be8cf8bda37c758100831675bff3b7c9b449251dc5d`; transcript SHA-256: `cff0da9b5aa1da844313e75cc2df397b7c26bee3228d4f38d0f6b8b49f588a0c`. Chromium 1228 loaded a disposable loopback page with DOM text `loopback-ok`; switching to public closed the prior page; the public context's loopback attempt was blocked with origin accept count unchanged at 1; stop made both proxy ports refuse new connections and `isAvailable()` false. The unique 4.7 MiB profile root had no open handles or matching Chromium residue, then was deleted and absence confirmed.

| gate at `f6db2015c` | outcome |
|---|---|
| `cd services/agent-runtime && bun run check` | pass; transcript SHA-256 `ba4a58a6fdd410276695a397888a0812f07d2576eaa6e3dd6b5a7d64990ef7d2` |
| `npm run check` | pass end-to-end; transcript SHA-256 `2a782ccf0b43958df7af8b1baa977dbf5e3135dd4e79d9f6869732f94b6a6083` |
| frontend lint | zero errors; the one pre-existing `ComposerProjectDrawer` complexity warning remains |
| `git diff --check` | clean |
| test/comment scope | no automated test file added, restored, modified, or run; final remediation source diff adds no comment and removes stale reader comments |

The remediation scripts and transcripts remain retained only in `/private/tmp/localstudio-pr367-remediation.lmGRQ8` for exact-head re-review. The real dependency clones and generated worktree outputs used by the full gate were removed afterward. A final ignored-residue audit also removed the lane's 208 KiB leaked standalone `Users/` trace, `next-env.d.ts`, TypeScript build info, and `services/node_modules` link; free disk returned to 5.3 GiB. No tracked source or user profile was removed.

## 10. Remaining proof (P)

- This branch is not pushed and has no CI result. The Opus-5 r1 **REVISE** findings are remediated and await exact-head re-review before integration into the canonical PR branch.
- The final combined head still needs semantic composition with accepted portions of #373 and #375; their raw patches do not apply cleanly.
- No installed Local Studio Dev build, live controller/browser recording, Windows browser, or Linux browser was exercised from this commit. The real-browser proof is isolated macOS arm64 worktree evidence only.
- Installed-app provenance, combined CI, and final release acceptance remain separate gates. Revert `f6db2015c`, `a7ee5fa17`, then `cbd8c7acd` to roll back the production behavior; evidence commits can be reverted independently.
