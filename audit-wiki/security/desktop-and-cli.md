# Desktop and CLI

The Electron desktop shell and the Bun CLI are the two client surfaces. The
desktop is, by some distance, the best-hardened component in the project; its
one inherent power is the embedded terminal. The CLI is small and clean. Both
verified 2026-06-09 against the working tree.

## Electron hardening (strong)

The `webPreferences` for app windows are correct
(`frontend/desktop/window-manager.ts:26-36`):
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`, `allowRunningInsecureContent: false`,
`navigateOnDragDrop: false`.

Navigation is locked (`frontend/desktop/security.ts`):

- `setWindowOpenHandler` denies all new windows and opens only `http(s)` URLs
  externally (`:5-10`).
- `will-navigate` on the app shell is origin-locked to the embedded server
  origin; off-origin `http(s)` is shunted to the system browser, anything else
  blocked (`:12-21,33-46`).
- `webviewTag` is enabled, but `will-attach-webview` strips any `preload` and
  forces `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` on
  guests (`:26-31`). Guest/OOPIF self-navigation is intentionally allowed for
  the embedded browser feature.

The embedded Next server is forked bound to `127.0.0.1` on a loopback-only port
(`app-server.ts:169,184`), tied to the Electron lifetime with SIGTERM→SIGKILL
teardown and a stale-PID reaper that validates ownership before killing. **No
custom protocol handlers are registered** anywhere — there is no deep-link
attack surface.

The IPC bridge (`preload.ts:4-42`, handlers in `main.ts:185-294`) is an
explicit allowlist of `desktop:*` channels exposed via `contextBridge`; no raw
Node or Electron API reaches the renderer. Most channels are benign (runtime
info, update status, UI prefs, project list), and the file-touching ones
(`load/save-session-prefs`, `load/save-ui-preferences`) write only to fixed
JSON paths under `userData` that the renderer cannot influence.

## The PTY is the one real power (medium)

The `desktop:pty-open` / `pty-write` / `pty-resize` / `pty-close` channels
(`main.ts:263-293`, `pty-manager.ts:140-196`) spawn the user's real login shell
(`$SHELL` or `/bin/zsh -l`; `COMSPEC` on Windows) with the full inherited
environment. Any renderer JS that reaches the bridge can open a terminal and
write arbitrary commands — full local code execution as the user.

This is the intended embedded-terminal feature. Its containment is entirely the
navigation lock (renderer pinned to the trusted local origin) plus the sandbox
and context isolation above. There is no command allowlist by design. `cwd` is
validated to an existing directory or falls back to `$HOME`
(`pty-manager.ts:77-87`); the replay buffer is capped at 200k chars; all PTYs
are killed on shutdown. The practical risk is conditional on a renderer
compromise (an XSS in the embedded app, or a malicious page escaping the
navigation lock), which the hardening above is specifically designed to
prevent.

## Auto-updater (medium)

The updater (`update-manager.ts`) uses `electron-updater`'s generic provider
with the feed URL taken solely from `VLLM_STUDIO_UPDATE_URL`
(`:13-31`), with `autoDownload` and `autoInstallOnAppQuit` both true
(`:95-96`). Two gaps:

- **No URL-scheme validation** — an `http://` feed would download updates over
  cleartext.
- **Linux AppImage has no signature verification** (`electron-builder.yml:74-76`).
  On macOS/Windows the signed-build code signature is checked, but the AppImage
  path is not, so a malicious or MITM'd feed could ship an arbitrary AppImage.

Mitigating: updates are **off by default** (no URL ⇒ disabled, `:19-22`), and
there is a kill-switch (`VLLM_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE`). Whether a
publisher public key is pinned beyond the OS code signature is not configurable
from the repo (no `publisherName`/notarize block in `electron-builder.yml`) —
**partially unverifiable**.

The macOS entitlements disable library validation
(`com.apple.security.cs.disable-library-validation: true`,
`entitlements.mac.plist`), which weakens dylib-injection protection. This is
the common requirement for the native `@lydell/node-pty` `.node` binary under
hardened runtime; `allow-unsigned-executable-memory` and
`allow-dyld-environment-variables` are correctly false.

## CLI (clean)

The CLI (`cli/`) handles credentials well:

- It **never writes credentials to disk.** Base URL and key are read from
  `VLLM_STUDIO_URL` / `VLLM_STUDIO_API_KEY` at request time (`api.ts:19-26`);
  no config file is created. The key is sent as an `X-API-Key` header.
- Default TLS validation is intact — no `rejectUnauthorized:false` or
  `NODE_TLS_REJECT_UNAUTHORIZED` anywhere.
- One low-severity note: pointing `VLLM_STUDIO_URL` at a remote `http://` host
  sends the key in cleartext (no HTTPS enforcement).

One supply-chain concern lives here, not in behavior: a **60 MB prebuilt
binary `cli/vllm-studio` is committed to git** (it is in `git ls-files` and not
excluded by `cli/.gitignore`). Its contents are unverifiable from source — a
compiled artifact in the repo is both bloat and an integrity question. See
[Supply chain and CI](supply-chain-and-ci.md).

## See also

- [Threat model](threat-model.md)
- [Supply chain and CI](supply-chain-and-ci.md)
- [Risk register](risk-register.md)
- droid-wiki: [Desktop app](../../droid-wiki/apps/desktop.md),
  [CLI](../../droid-wiki/apps/cli.md), [Deployment](../../droid-wiki/deployment.md).
