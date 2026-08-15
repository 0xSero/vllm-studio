# Security Request Authority — PR #363 port evidence

Production slice from the GLM-5.3 implementation lane landing on branch `codex/v201-security-request-authority-20260814`, exact base `a5813610f6490f560b54f58cc61a18b5bed5ca75` (canonical v2.0.1 track head). Closes the keyless-controller DNS-rebinding/cross-site request-authority boundary by porting the unique production behavior of PR #363. Evidence only; nothing here upgrades any `GOAL.md` row.

## 1. Provenance (C)

| item | value |
|---|---|
| PR | #363 (`fix/222-controller-request-authority`) |
| PR head | `791fe1d210b057a5b905af5a93ed420cfb80ac78` (merge of `dev` into the fix branch) |
| Source commit | `327b14bf0afa5a20060742a2885e820c0f88d7c9` `fix(controller): guard keyless request authority` |
| Source author | `fettpl <38704082+fettpl@users.noreply.github.com>` (preserved via `Co-authored-by` trailer) |
| Port commit | `6f1f06c5ce548972365884a1122e399941cb800a` on this branch |
| Verification | PR head and source commit are byte-identical across the five production paths (`git diff 327b14bf 791fe1d21 -- <paths>` is empty) |

Port method: hunk-by-hunk review of the source diff against current track files, not a cherry-pick. Current-track deltas found and preserved (both pre-date this slice): `.env.example` mock-inference block removed later on this track; `app.ts` audio/speech routes removed later on this track. `env.ts` and `security-middleware.ts` were identical to the source parent, so those hunks applied exactly.

## 2. Exact source scope (C)

Source commit file list: `.env.example`, `controller/src/config/env.ts`, `controller/src/config/request-authority.ts` (new), `controller/src/http/app.ts`, `controller/src/http/security-middleware.ts`, plus two test files.

Production files ported (all owned paths, nothing else touched):

| path | change |
|---|---|
| `.env.example` | +3/−1 — documents `LOCAL_STUDIO_ALLOWED_HOSTS` contract beside the keyless opt-out |
| `controller/src/config/env.ts` | +28/−15 — `allowed_hosts?: string[]` on `Config`; imports authority helpers; drops local loopback/origin helpers; IPv6 loopback CORS defaults; `LOCAL_STUDIO_ALLOWED_HOSTS` env schema entry; trims API key; wildcard keyless bind refusal |
| `controller/src/config/request-authority.ts` | new, 132 lines, byte-identical to source (`git show 327b14bf:<path> \| diff - <path>` clean) |
| `controller/src/http/app.ts` | +2 — guard middleware registered immediately after `controllerRuntimeMiddleware`, before CORS |
| `controller/src/http/security-middleware.ts` | +31 — `requestAuthority` helper + `createKeylessRequestGuardMiddleware` |

Excluded test paths (never added, restored, copied, or modified): `controller/tests/http-app.test.ts`, `controller/tests/request-authority.test.ts`. The current track has no `controller/tests/` directory and this slice did not create one.

Diff hygiene: `git diff --check` clean; no source comments in the diff (`//` matches are URLs inside template literals; `#` matches are `.env.example` documentation lines only); no secret-shaped content (scan for `key/token/secret/password/bearer =` patterns found only env-var names, schema keys, and diff context markers).

## 3. Behavior contract (C)

- Authority normalization (`request-authority.ts`): lowercase trim; hostname labels validated against RFC-1123 shape; numeric IPv4 (decimal/hex forms) canonicalized through URL parsing; IPv6 accepted bracketed and canonicalized via `new URL("http://[v]")`; rejects unbalanced brackets, `@`, `/`, `*`, trailing dot, over-253 names, and embedded userinfo; wildcards (`0.0.0.0`, `::`) are valid bind targets but never valid request authorities.
- `normalizeHttpOrigin`: HTTP(S) only; rejects embedded credentials, non-root paths, query, fragment, and unparseable hosts.
- `normalizeRequestAuthority`: optional exact port; a supplied port must be an integer in 1–65535 equal to `config.port`; authority shape with whitespace, `@`, `?`, `#`, or `/` rejected.
- `LOCAL_STUDIO_ALLOWED_HOSTS`: comma-separated, each entry must normalize to an exact host/IP (wildcards rejected, empty list rejected); decoded only in keyless mode; defaults are the loopback set (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`) for a loopback bind, the bind host itself for a non-wildcard LAN bind, and empty for a wildcard bind.
- Keyless wildcard bind without an explicit allowlist refuses startup: `LOCAL_STUDIO_ALLOWED_HOSTS is required for a keyless wildcard controller bind`.
- Guard middleware: skipped when `api_key` is set (API-key semantics unchanged, including hostile-Host requests passing to auth); in keyless mode requires Host authority in `allowed_hosts` and, when Origin is present, an origin in `cors_origins`; malformed Origin values are treated as hostile. Failures return generic `403 {"detail":"Forbidden request origin"}` with no CORS or rate-limit headers, proving the guard precedes CORS, logging, rate limiting, auth, and route execution.

## 4. Live probe matrix (C)

Method: `bun src/main.ts` from the worktree controller with a fresh disposable `mktemp -d` scratch directory for `LOCAL_STUDIO_DATA_DIR`/`DB_PATH`/`MODELS_DIR`, ports 18080–18082 (inference 18000), metrics disabled. All scratch directories and the single-use probe API key (generated per run from `/dev/urandom`, never echoed) were destroyed after the run; no repo data directory was opened.

| # | scenario | result |
|---|---|---|
| A | keyless startup, `LOCAL_STUDIO_ALLOWED_HOSTS=*.example.com` | exit 1, `must contain a nonempty comma-separated list of exact hostnames or IP addresses` |
| A2 | keyless startup, blank-only allowlist `' , '` | exit 1, same error |
| B | keyless `LOCAL_STUDIO_HOST=0.0.0.0` + `ALLOW_UNAUTHENTICATED=true`, no allowlist | exit 1, `LOCAL_STUDIO_ALLOWED_HOSTS is required for a keyless wildcard controller bind` |
| C | keyless loopback server (defaults), port 18080 | listening |
| C1 | `Host: localhost:18080` + `Origin: http://localhost:3000` | 200 |
| C2 | native curl (default Host `127.0.0.1:18080`, no Origin) | 200 |
| C3 | `Host: [::1]:18080` + `Origin: http://[::1]:3000` | 200 |
| C4 | `Host: attacker.example` | 403 |
| C5 | `Host: attacker.example` + `Origin: https://attacker.example` (rebinding pair) | 403 |
| C6 | allowed host, wrong port (`127.0.0.1:9999`) | 403 |
| C7 | out-of-range port (`127.0.0.1:99999`) | 403 |
| C8 | malformed bracketed host (`[::1`) | 403 |
| C9 | wildcard authority (`0.0.0.0:18080`) | 403 |
| C10 | valid host, well-formed disallowed Origin (`http://localhost:9999`) | 403 |
| C11 | malformed Origin (`javascript:alert(1)`) | 403 |
| C12 | Origin with embedded credentials (`https://user:pass@localhost:3000`) | 403 |
| C13 | hostile Host + allowlisted Origin → `HTTP/1.1 403` with **no** `access-control-allow-origin` header | guard precedes CORS |
| C14 | hostile Host POST to `/api/models` → 403 with no `x-ratelimit-*` headers | guard precedes rate limiting |
| C15 | 403 body | exactly `{"detail":"Forbidden request origin"}` |
| D1 | API-key mode, wildcard bind, hostile Host+Origin, valid Bearer key | 200 (guard skipped) |
| D2 | same without key | 401 (auth unchanged) |
| D3 | API-key mode, native Host, `x-api-key` | 200 |
| E1 | keyless wildcard bind, `ALLOW_UNAUTHENTICATED=true` + `ALLOWED_HOSTS=localhost,127.0.0.1` (required for this server to start, matching row B), `Host: localhost:18082` | 200 |
| E2 | same server, `Host: studio.lan:18082` (not allowlisted) | 403 |
| E3 | same server, `Host: evil.example` | 403 |

## 5. Validation (C)

| gate | command | outcome |
|---|---|---|
| whitespace/conflict markers | `git diff --check` | clean (exit 0) |
| controller typecheck | `cd controller && bun run typecheck` | pass |
| controller lint | `cd controller && bun run lint` | pass |
| controller static suite | `cd controller && bun run check` (knip, jscpd 0 clones, depcheck, standards) | pass, 0 errors/0 warnings |
| full repo gate | `npm run check` from root (automation, contracts, structure, frontend, controller, agent-runtime) | pass end-to-end |

Dependencies were installed fresh in this worktree via `node scripts/project.mjs setup` (bun frozen-lockfile installs + frontend `npm ci`). No hooks bypassed; the `.githooks` pre-commit (typecheck) ran during the production commit.

## 6. Remaining proof (P)

- Installed-app and final-head verification remain open for the release lane: probes above exercised the worktree controller only. The installed desktop app bundles a controller build and is refreshed only via `scripts/install-desktop-app.sh`; rebuild/reinstall was not triggered by this slice.
- Not pushed; branch awaits PR into `dev` per `docs/workflow.md`.

## 7. Post-review follow-up probes (C)

Run after the Opus-5 R1 review (approve with findings) against the unchanged production head `6f1f06c5c`; no repository file was modified to run them.

Non-wildcard keyless bind shape. The preferred `127.0.0.2` loopback-alias bind is blocked on this host: `lo0` carries only `127.0.0.1`, so binding `127.0.0.2` fails with `EADDRNOTAVAIL` (adding the alias requires sudo and was not performed). The alias's product-level classification was still proven at config time: keyless `LOCAL_STUDIO_HOST=127.0.0.2` without the opt-out refuses startup with the non-loopback API-key error. The live bind therefore used the host's true LAN address on `en0`:

| # | scenario | result |
|---|---|---|
| F0 | keyless `LOCAL_STUDIO_HOST=127.0.0.2`, no opt-out | exit 1, `LOCAL_STUDIO_API_KEY is required when binding the controller to a non-loopback host…` |
| F1 | keyless `LOCAL_STUDIO_HOST=192.168.1.62` + `ALLOW_UNAUTHENTICATED=true`, no allowlist | listening; `Host: 192.168.1.62:18083` → 200 |
| F2 | same server, `Host: localhost:18083` (hostname alias) | 403 |
| F3 | same server, `Host: 127.0.0.1:18083` (address alias) | 403 |
| F4 | connect via `127.0.0.1:18083` | unreachable — the bind is interface-specific |

Limitation (C): the LAN bind was reachable from the local network for a ~15-second window on disposable `mktemp` data; isolation relied on the enabled macOS application firewall and the exact-Host guard rather than a dedicated firewall rule, and no remote client actually connected. A fully firewalled LAN environment was not available without privileged network changes.

Shipped frontend proxy path against a keyless loopback controller (port 18080), using the pre-existing `frontend/.next/standalone` build output with `BACKEND_URL=http://localhost:18080` and a fresh `LOCAL_STUDIO_DATA_DIR` containing no `api-settings.json` (defaults applied); no build or install was performed:

| # | scenario | result |
|---|---|---|
| G1 | `GET /api/proxy/health` through the frontend on `localhost:13000` | 200, body `{"status":"ok"}` from the controller |
| G2 | SSE attach `GET /api/proxy/events` (the browser EventSource path) | `HTTP/1.1 200`, `content-type: text/event-stream`, 3,177 bytes of keepalive/event frames within 4 s; curl exit 28 is the expected never-ending stream |

The proxy request carries no Origin and its Host is the controller's own, so the keyless guard admits the shipped browser/desktop path unchanged.

## 8. Follow-ups recorded, not fixed here (P)

- Controller and frontend carry two divergent host-authority normalizers (`controller/src/config/request-authority.ts` vs `frontend/src/lib/security/request-boundary.ts`, both exporting `isLoopbackHost` with different acceptance rules). Consolidating into `shared/` would break the deliberate byte-identity with upstream `327b14bf`, so it stays a follow-up.
- Guard rejections are silent because the guard precedes logging/observability, leaving no audit trail for blocked rebinding attempts and nothing server-side for misconfigured-Host support cases.
- A trailing-comma or otherwise malformed allowlist entry throws a startup error that does not name the offending entry.
- Full `npm run check` passed after applying this amendment: all six top-level gates green, final `NPM-CHECK-EXIT:0`; transcript `/tmp/localstudio-v201-security-request-authority-check-r2.log`, SHA-256 `a26042481d7df3164782ab43ae076b62d7c514ca39c139b86217e4a30a861aee`. This final evidence-line update is markdown-only.
