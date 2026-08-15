# Frontend fail-closed access — PR #366 selective port evidence

Selective production port on branch `codex/v201-pr366-security-20260815`, based on repaired convergence head `3f173e3f88bf5d6d4a6c9669ed79824b169aca48`. Evidence was captured 2026-08-15 EDT. This lane does not claim installed-app, CI, merge, or release acceptance.

## 1. Provenance and disposition

| Item | Value |
|---|---|
| Source PR | #366, `[Security] Fail closed before exposing privileged frontend APIs` |
| Source base | `a765eb27bca4baffabc6dc84c553fc6d8be5590d` (`dev`) |
| Source head | `d2dbdda8038ead0a7eb562b8e5e92ec62f86daea` |
| Source author | `fettpl <38704082+fettpl@users.noreply.github.com>` |
| Port base | `3f173e3f88bf5d6d4a6c9669ed79824b169aca48` |
| Product commit | `e7e22f7226022dba8a52e8834628c4543f10ef7c` `fix(security): fail closed before frontend access` |
| Documentation commit | `2395ab25d` `docs(security): document frontend access posture` |

The audited product slice is eight paths and +273/−100. Its stable patch ID is exactly `a7aba50d83854d9e86682f1d75a6e7616d4eb355`, matching the independently frozen PR #366 production slice. Seven product files are byte-identical to the PR head. The `frontend/desktop/project.mjs` startup hunk has stable patch ID `0b717d873e7a769bf755b3035ef06564a18331ad`, also exactly matching upstream while preserving all newer canonical dispatcher behavior around it.

`frontend/src/app/api/auth/session/route.test.ts` was excluded entirely. No automated test file was added, restored, modified, or run. `frontend/desktop/logic/app-server.ts` was not touched because canonical already supplies `NODE_ENV=production`, `HOSTNAME=127.0.0.1`, and `LOCAL_STUDIO_DESKTOP=1` to the embedded server.

## 2. Exact source scope

| Path | Delta from port base |
|---|---:|
| `frontend/desktop/project.mjs` | +12/−5 |
| `frontend/src/app/access/page.tsx` | +37/−0 |
| `frontend/src/app/api/auth/session/route.ts` | +125/−0 |
| `frontend/src/lib/auth/access-posture.d.mts` | +11/−0 |
| `frontend/src/lib/auth/access-posture.mjs` | +31/−0 |
| `frontend/src/lib/auth/access.ts` | +9/−38 |
| `frontend/src/lib/auth/guard.ts` | +12/−11 |
| `frontend/src/proxy.ts` | +36/−46 |

The two documentation/configuration paths add the production instructions without overwriting newer canonical README material:

| Path | Delta from port base |
|---|---:|
| `README.md` | +10/−0 |
| `frontend/.env.example` | +10/−7 |

The full range through `2395ab25d` is ten paths and +293/−107. `git diff --check` is clean. All eight touched product-source files are free of source comments.

## 3. Security contract

- Development remains open when `NODE_ENV` is not `production`.
- Embedded desktop access is open only when `LOCAL_STUDIO_DESKTOP=1` and `HOSTNAME` is an explicit IPv4 or IPv6 loopback address. Merely setting `LOCAL_STUDIO_DATA_DIR` does not bypass authentication.
- Production web access requires a nonempty `LOCAL_STUDIO_FRONTEND_TOKEN` or the exact acknowledgement `LOCAL_STUDIO_FRONTEND_ALLOW_UNAUTHENTICATED=true`; all other spellings fail closed.
- `npm start` constructs its production server environment and resolves this posture before checking build availability, copying standalone assets, starting the agent runtime, or spawning Next.
- Browser token entry is a bounded 4 KiB `application/x-www-form-urlencoded` POST decoded through Effect Schema. Duplicate token fields, invalid UTF-8, unsupported media types, and oversized bodies are rejected.
- The session exchange compares tokens with Node's constant-time primitive and sets a 30-day Path `/`, HttpOnly, SameSite=Lax access cookie. Secure follows the effective HTTPS protocol.
- API clients may use the token header. Query-string tokens never authenticate: page GET/HEAD requests are redirected to a cleaned URL, while API or mutation requests receive 400.
- The existing Host, forwarded-Host, Tailscale identity, Origin, cross-site, and CSRF boundary executes before access authentication. The access-form route bypasses only the double-submit token requirement; hostile Host, Tailscale identity, Origin, and cross-site requests remain rejected.
- Documentation requires a generated high-entropy shared secret and a trusted TLS proxy that strips client forwarding headers and sets `X-Forwarded-Proto` itself.

## 4. Manual process probes

A one-shot Node process imported only `resolveAccessPostureFromEnvironment` and printed decision kinds, never token values.

| Scenario | Result |
|---|---|
| development | `allow/development` |
| production without token/acknowledgement | `configuration-error` |
| production with data directory only | `configuration-error` |
| desktop plus `127.0.0.1` | `allow/desktop` |
| desktop plus `::1` | `allow/desktop` |
| desktop plus `0.0.0.0` | `configuration-error` |
| production with disposable token | `require-token` |
| acknowledgement exactly `true` | `allow/explicit-unauthenticated` |
| acknowledgement `TRUE` | `configuration-error` |

Clean-environment `node frontend/desktop/project.mjs start` probes proved startup ordering. No access configuration and nonloopback desktop mode failed at the access posture. Token, exact acknowledgement, and loopback desktop mode passed that preflight and reached the later missing-standalone guard.

## 5. Static and production-build gates

Both source commits passed their normal Git hook without bypass; the hook ran frontend lint-staged formatting and TypeScript checking for the product commit and TypeScript checking for the documentation/configuration commit.

The first aggregate invocation reached the agent-runtime bundle and failed because the desktop tool environment omitted the installed Bun binary from `PATH`; no source finding occurred. The unchanged command was rerun with `/Users/sero/.bun/bin` prepended, resolving Bun 1.3.14.

`npm run check` then passed end to end at `2395ab25d`, including automation layout, shared contracts, structure, frontend lint/typechecks/cycle/UI/dead-code/duplicate/dependency checks, production Next build, standalone repair/assertion, controller typecheck/lint/standards, and agent-runtime build. The production route inventory included `/access` and `/api/auth/session`. The only frontend lint diagnostic was the pre-existing complexity warning in `composer-project-drawer.tsx`; there were zero errors. The transcript ends `NPM_CHECK_EXIT=0`.

## 6. Isolated standalone curl matrix

The accepted standalone runs used loopback frontend/runtime ports 14783/14881, a disposable process `HOME`, data directory, Pi directory, and session directory, plus a disposable literal token. No controller or user session was opened.

| Scenario | Result |
|---|---|
| unauthenticated access page | 200 and rendered `Unlock Local Studio` |
| unauthenticated page | 303 to `/access` |
| unauthenticated API health | 401 |
| header or cookie token API health | 200 |
| mixed-case query token on API | 400, never authenticated |
| mixed-case query token on page | 303 to the token-free URL, no access cookie |
| JSON form | 415 |
| duplicate token fields | 400 |
| form over 4 KiB | 413 |
| invalid token | 303 to `/access?error=invalid`, no access cookie |
| valid token over HTTP | 303 with 30-day Path `/`, HttpOnly, SameSite=Lax cookie without Secure |
| valid token behind trusted forwarded HTTPS | same cookie with Secure |
| hostile Host | 421 before auth |
| cross-site form | 403 |
| foreign-Origin form | 403 |

A second accepted run configured exact Tailscale host and user allowlists:

| Scenario | Result |
|---|---|
| allowed remote Host without user | 403 |
| allowed remote Host with wrong user | 403 |
| allowed Host/user without frontend token | 401 |
| allowed Host/user with header token | 200 |
| hostile forwarded Host with otherwise valid credentials | 421 |
| allowed Host/user access page | 200 |
| same-origin HTTPS form | 303 with Secure HttpOnly access cookie |
| forwarded HTTPS with HTTP Origin | 403 |

## 7. Evidence, isolation, and cleanup

Evidence directory: `/Users/sero/projects/vllm-studio-v201-evidence/pr366-security-20260815`.

| Artifact | SHA-256 | Purpose |
|---|---|---|
| `manual-probes.md` | `6d6e7beac68d79790681f3a8fbce84358976486ef7859dfb962cc8ddd36fda9f` | posture/startup matrix |
| `curl-matrix.md` | `dac9e87ffaef14d4d3c579714c619d1ca84783af4caa7b8c08fd0c57d8325c76` | redacted standalone matrix |
| `npm-check.log` | `4384e5f1d76c9b468235942dcc90aefc122f35c69220db58ebe88808c4963efb` | environment-only red aggregate run |
| `npm-check-r2.log` | `44bcbe7983d2872c739b77039d2a6cc8ff1b24582464a85f7bf8006f74b2204c` | passing aggregate run |
| `agent-runtime-bundle.log` | `96e51dc2143da738d9fb6f9dcadd271fb3b795640c753415466736f87b7fb9e2` | standalone runtime preparation |
| `standalone.log` | `ace85c139415198d69cb965ffae6bd9880924023a92e3ed502a7143b8db1e0f1` | first start, missing post-check runtime bundle |
| `standalone-r2.log` | `ebb68d474430138aeda0b70671d7186c6c033e9e6bf4297f64cc7c836bdcb69d` | stopped legacy-migration discovery |
| `standalone-r3.log` | `1f09c2354aa98357cac3e7cdf60c169c6c7c43dd600aad77547bbd50fdfe9e0a` | isolated loopback acceptance server |
| `standalone-r4-tailscale.log` | `01652cba8e15180356963f92f8bc37e9bd864821da49e6515574fc43feacdfaa` | isolated Tailscale acceptance server |

The first data-isolated start revealed that agent-runtime legacy migration still reads the user's legacy settings when process `HOME` is not isolated. It copied that file into the disposable directory before any curl request. Both processes were stopped immediately; the contents were never inspected; the exact disposable directory was deleted. Accepted runs also isolated `HOME` and performed no migration. The retained transcript contains paths only, not setting values.

After acceptance, ports 14783 and 14881 had no listeners, no matching frontend/runtime process remained, and both disposable probe directories were deleted. Validation dependency clones and generated build output are lane-owned and are removed after sealing this document.

## 8. Residual risks and remaining acceptance

- The frontend gate remains a shared-secret design. It has no login-specific rate limiting, and the HttpOnly cookie contains the shared secret rather than an independently minted session identifier.
- Trusted forwarded-protocol handling is an operational boundary. A directly exposed proxy that preserves client-supplied `X-Forwarded-Proto` can misstate the cookie's Secure attribute; the README now requires header replacement by the trusted TLS terminator.
- This lane is unpushed and has no CI, independent final-head review, installed desktop verification, merge, or release proof. Those remain program integration gates.

## 9. Canonical integration

The approved eight-path product slice was applied after parser reconciliation head `a3e51ddd1` as canonical commit `5ffaf8c49`. The operator documentation followed as `f695669bc`, and this evidence ledger followed as `edd106d2c`. No stale branch range or excluded test path was merged. A second independent line-by-line review approved the eight product paths with no P0, P1, or P2 finding and confirmed there is no product-path overlap with the already integrated controller request-authority or browser-reader work.

The canonical posture probe passed development, closed production, IPv4 and IPv6 desktop loopback, rejected wide-bind desktop, token, exact acknowledgement, and rejected nonexact acknowledgement cases. Transcript: `/Users/sero/projects/vllm-studio-v201-evidence/pr366-security-20260815/canonical-posture-probe.log`, SHA-256 `a11446b6eb276e06724e22aada64644cdf7e315a75d194d7e6f8c275d1265b4b`.

The exact root `npm run check` passed at canonical head `edd106d2c`, including all 22 static/dynamic page-generation entries, `/access`, `/api/auth/session`, standalone repair/assertion, controller gates, and the agent-runtime build. Transcript: `/Users/sero/projects/vllm-studio-v201-evidence/pr366-security-20260815/canonical-root-check.log`, SHA-256 `03c0e150cf1f7af5e4dfbf1a5b699aaa84a0fc76f6aafdef2b038b260250ebc8`, ending `CANONICAL_ROOT_CHECK_EXIT=0`. Touched product source remains comment-free, and no automated test path was added, restored, modified, or run.

Canonical push, CI, installed-app login behavior, and release acceptance remain pending at this checkpoint.
