# vLLM Studio Browser Bridge (Brave / Chromium)

Lets the vLLM Studio agent drive **your real, logged-in browser** (default profile,
cookies, sessions) using the extension's `chrome.debugger` permission — no
`--remote-debugging-port`, no Codex, all original code.

```
cdp-browser.ts  ⇄ CDP/WS ⇄  bridge.mjs  ⇄ WS ⇄  extension  ── chrome.debugger ──▶  your tabs
```

## Setup (one time)

1. **Load the extension** in Brave:
   - Open `brave://extensions`
   - Toggle **Developer mode** (top-right)
   - **Load unpacked** → select this folder's `extension/` directory
   - It appears as **vLLM Studio Browser Bridge**.

2. **Run the bridge** (keep it running while you use the browser tool):

   ```bash
   node frontend/desktop/resources/brave-bridge/bridge.mjs
   ```

   `node` resolves `ws` from `frontend/node_modules`, so any cwd is fine.
   Check it: open <http://127.0.0.1:9222/> → should say `extension: connected`.

3. **Point the agent at it** — set for the agent runtime:
   ```bash
   export VLLM_STUDIO_BROWSER_BACKEND=cdp
   # endpoint defaults to http://127.0.0.1:9222 (the bridge); override with
   # VLLM_STUDIO_CDP_ENDPOINT if you change BRAVE_BRIDGE_PORT.
   ```

Then select `@chrome` / `@browser` (or enable the browser tool) in the composer.
The `cdp_*` tools (navigate, get_text, eval, click, screenshot, …) now act in
your logged-in Brave tabs.

## Notes

- Brave shows a "vLLM Studio Browser Bridge is debugging this browser" bar while
  attached — that's the debugger session; closing it detaches.
- `chrome.debugger` can't attach to `brave://`/`chrome://`/web-store pages; use a
  normal http(s) tab.
- Change the port with `VLLM_STUDIO_BRAVE_BRIDGE_PORT=9333 node …/bridge.mjs` and
  set `VLLM_STUDIO_CDP_ENDPOINT=http://127.0.0.1:9333` to match.
