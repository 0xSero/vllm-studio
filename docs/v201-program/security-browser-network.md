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
- Switching modes closes the previous browser context; manager abort/stop closes the active context plus pending and established proxies.

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

## 8. Remaining proof (P)

- This branch is not pushed and has no CI result. It awaits review and integration into the canonical PR branch.
- The final combined head still needs semantic composition with accepted portions of #373 and #375; their raw patches do not apply cleanly.
- No installed Local Studio Dev build, live controller/browser recording, Windows browser, or Linux browser was exercised from this commit. The real-browser proof is isolated macOS arm64 worktree evidence only.
- Installed-app provenance, combined CI, and final release acceptance remain separate gates. Revert `cbd8c7acd` to roll back the production behavior; the evidence commit can be reverted independently.
