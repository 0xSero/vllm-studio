# Risk register

Every finding from the security review, consolidated and prioritized. Each row
carries a severity, the precondition that makes it exploitable, the evidence
(file:line), and a concrete remediation. Severity reflects code-supported
impact and likelihood; the **precondition** column is where most of the nuance
lives — several high-severity findings require a non-default exposure.

Ratings assume the **standalone/LAN deployment** (the documented homelab
setup). In strict loopback-only single-user mode, the network-reachability
preconditions are not met and the RCE/SSRF findings drop to local-only.

## High

| # | Finding | Precondition | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| H1 | **Unauthenticated shell RCE via the terminal route** — `execAsync(command)` with no validation, no auth | Frontend reachable (LAN/standalone) | `frontend/.../api/agent/terminal/route.ts:42`; `contracts/terminal.ts:13-18` | Add auth to all frontend API routes; bind the standalone server to loopback unless a token is set; gate the terminal behind explicit local-only checks |
| H2 | **Unauthenticated agent RCE** — `POST /api/agent/turn` drives `bash`/`write`/`edit` with a client-chosen `cwd`, no approval gate | Frontend reachable | `api/agent/turn/route.ts:138`; `pi-sdk-runtime.ts:144,220`; `pi-runtime-helpers.ts:84-95` | Authenticate the turn endpoint; confine `cwd` to an allowlisted project root; add a tool-approval/read-only mode for non-local callers |
| H3 | **Arbitrary file read** — `cwd=/`, `path=etc/passwd` passes containment; symlink escape (comment overstates protection) | Frontend reachable | `fs-store.ts:20-26,67`; `api/agent/fs/file/route.ts:18` | Resolve symlinks with `realpath` and re-check containment; confine `rootCwd` to allowlisted roots |
| H4 | **Proxy leaks the server API key to an attacker-controlled public host** — public `x-backend-url` accepted, key attached as Bearer | Frontend reachable; an API key configured | `proxy/route.ts:175,208-209,393-394` | Allowlist public override targets too (not just private); never attach the configured key to an override host the operator did not approve |
| H5 | **Controller SSRF + bearer reflection** — `/controllers/route/*` forwards to any `target` and reflects client `Authorization` to it; follows redirects; GET unthrottled | Controller reachable (unauth if no key; key-holder otherwise) | `controller/.../http/app.ts:61-96` (target 62, auth fwd 82-83, fetch 88) | Allowlist target hosts; never forward the inbound `Authorization`; disable redirect-following or re-validate per hop |
| H6 | **Controller recipe-launch RCE** — `launch_command`/`custom_command` = arbitrary binary+argv; unvalidated `extra_args`/`env_vars`; reachable via recipe CRUD | Controller unauthenticated (no key set) | `backend-builder.ts:174-183,271-285`; `process-manager.ts:314-329`; `recipe-serializer.ts:117` | Always set `VLLM_STUDIO_API_KEY`; consider an allowlist for override binaries |
| H7 | **Controller runtime-upgrade RCE** — `/runtime/*/upgrade` executes request-supplied `command`+`args` | Controller unauthenticated | `engines/routes.ts:333-474`; `runtime-upgrade.ts:26-47`; `core/command.ts:19` | Same as H6; restrict the command set these endpoints accept |
| H8 | **`next ^16.1.6` high-severity advisory cluster** (smuggling, CSRF bypass, SSRF, DoS, cache poisoning) | Frontend reachable | frontend `npm audit`; `frontend/package.json` | Upgrade Next past 16.3.0 |

## Medium

| # | Finding | Precondition | Evidence | Remediation |
| --- | --- | --- | --- | --- |
| M1 | **Prompt injection → unconfined tools** — fetched web/file content can steer the agent into shell commands, no approval | Agent in use; untrusted content reachable | `vllm-studio-agent-policy.ts:18-23` (prompt-only); fetch + bash in same loop | Tool-approval gate; sandbox the agent's exec; treat fetched content as untrusted |
| M2 | **Proxy DNS-rebinding + redirect SSRF** — hostname-only guard, no IP pinning, default redirect-follow | A private override allowed (DNS attacker, or desktop mode) | `proxy/route.ts:112,326` | Resolve and pin the IP (as `agent/browser/fetch` does); re-validate redirects |
| M3 | **Unauthenticated settings write + git push/commit** | Frontend reachable | `api/settings/route.ts:48`; `api/agent/git/route.ts`, `git/service.ts:45` | Authenticate these mutating routes |
| M4 | **MCP plugin loader spawns arbitrary processes** from a client-pointable `.mcp.json`; child inherits the API key in env | Frontend reachable; attacker can point at an on-disk config | `mcp-plugin.ts:124-128,269-277`; `contracts/turn.ts:29` | Allowlist/validate plugin configs; do not pass the API key into child env |
| M5 | **Rate-limit bypass via spoofed `X-Forwarded-For`**; GET unthrottled | Controller not behind a header-normalizing proxy | `security-middleware.ts:25-32,60-62,96-98` | Trust XFF only from known proxies; rate-limit reads too |
| M6 | **No auth at all when `VLLM_STUDIO_API_KEY` unset** — only `/health` ever public; enables H6/H7 unauth | `ALLOW_UNAUTHENTICATED=true` + non-loopback, or reverse proxy in front of keyless loopback | `security-middleware.ts:6,21-23,71-73`; `env.ts:136-141` | Require a key whenever reachable beyond loopback; document the reverse-proxy case |
| M7 | **`trust_remote_code` defaults true** — launching/downloading a model runs its repo code | Auth-gated recipe launch/download | `recipe-serializer.ts:107` | Default to false; require explicit opt-in per recipe |
| M8 | **Build-output API key could be packaged** — `standalone/data/api-settings.json` holds a live key; electron-builder copies `standalone` with no `data/` exclusion | A desktop build without pruning `standalone/data` | `electron-builder.yml:16-19` | Add a `data/` exclusion to `extraResources`; prune before packaging |
| M9 | **Postgres default creds on `0.0.0.0`** | Host without firewall | `docker-compose.yml:9-13` | Bind `127.0.0.1:5432`; set a real password |
| M10 | **TruffleHog pinned to a moving branch**; all actions on floating tags | CI runs | `security.yml:26`; all workflows | Pin actions to commit SHAs |
| M11 | **Auto-updater accepts any feed URL, no scheme check; Linux AppImage unverified** | `VLLM_STUDIO_UPDATE_URL` set to http / MITM | `update-manager.ts:13-31,95-96`; `electron-builder.yml:74-76` | Enforce https; verify AppImage signatures / pin a publisher key |
| M12 | **Desktop PTY = full local shell to the renderer** | Renderer compromise (XSS / nav-lock escape) | `main.ts:263-293`; `pty-manager.ts:140-196` | Defense-in-depth on the renderer; the existing origin lock + sandbox are the primary control |

## Low / info

| # | Finding | Evidence |
| --- | --- | --- |
| L1 | `/config` & `/studio/diagnostics` disclose filesystem paths, hostnames, versions (never the key) | `system/routes.ts:208-304`; `studio/routes.ts:186-224` |
| L2 | `/logs`, `/events` expose raw engine logs that may echo operator secrets passed as recipe args | `logs-routes.ts:109,159,196,214` |
| L3 | No CSP / `X-Frame-Options` / security headers on the frontend | `next.config.ts` (no `headers()`) |
| L4 | API key plaintext on disk (`0600`); backend-url cookie not `Secure` over http | `api-settings.ts:43`; `backend-url.ts:22-24` |
| L5 | `postcss` moderate XSS (build-time) | frontend `npm audit` |
| L6 | 60 MB prebuilt `cli/vllm-studio` binary committed to git | `git ls-files cli` |
| L7 | macOS entitlements disable library validation | `entitlements.mac.plist` |
| L8 | SQLite DB created at default umask (may hold recipe secrets) | `stores/sqlite.ts:21-26` |

## Notable positive controls

Worth recording, because the register above is a deliberate worst-case lens:

- Constant-time API-key comparison with a length guard
  (`security-middleware.ts:51-58`); CORS allowlist with a `null` fallback.
- The inference proxy pins upstreams and does **not** forward the controller
  key to inference backends (`openai-routes.ts:293-305`).
- `models_dir` prefix-confinement on delete/move; download-path `..`-stripping;
  log-session-id char allowlist defeating traversal.
- Chat content is never persisted — the chat tables are dropped at startup
  (`stores/sqlite.ts:3-19`).
- The `agent/browser/fetch` route is an exemplary SSRF defense (DNS-pinned IP,
  redirect revalidation, HTML sanitization, size/time caps).
- Markdown renders without `rehype-raw`; highlight.js sinks are escaped;
  terminal output uses xterm (no HTML execution).
- Electron: context isolation + sandbox + no node integration, origin-locked
  navigation, explicit IPC allowlist, no custom protocol handlers,
  loopback-only embedded server.
- Clean git secret hygiene; no git/tarball dependencies; all deps from the
  registry with integrity hashes; committed lockfiles.

## Suggested order of remediation

1. **Authenticate the frontend** (H1–H3, M3) — the single change that closes
   the most severe paths. Either bind standalone to loopback by default or add
   a shared-secret gate to the API routes.
2. **Upgrade Next** past 16.3.0 (H8).
3. **Fix the two SSRF/credential-reflection paths** (H4, H5).
4. **Always require the controller key when reachable** (M6), and default
   `trust_remote_code` to false (M7).
5. **Harden the build/release path** (M8) and the Postgres defaults (M9).
6. The hardening backlog (M10–M12, L1–L8) as follow-up.

## See also

- [Threat model](threat-model.md) — the map these findings sit on.
- [Controller security](controller.md) · [Frontend and proxy](frontend-and-proxy.md)
  · [Desktop and CLI](desktop-and-cli.md) · [Supply chain and CI](supply-chain-and-ci.md)
