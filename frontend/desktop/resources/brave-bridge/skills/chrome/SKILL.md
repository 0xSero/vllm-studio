---
name: chrome
description: "Control the user's real, logged-in browser (Brave/Chromium) — navigate, read pages, click, fill, run JS, screenshot. Use for tasks needing the user's cookies, sessions, or existing tabs."
---

# Chrome / Browser (vLLM Studio)

vLLM Studio's own browser control. It drives the user's **real, logged-in**
Brave/Chromium profile through the bundled extension + local CDP bridge — so you
act inside their actual session (cookies, history, open tabs).

## Setup (if tools error with "extension not connected")

The browser bridge must be running and the extension loaded. If a `cdp_*` tool
reports the extension/endpoint isn't connected, tell the user to:

1. Load the **vLLM Studio Browser Bridge** extension in `brave://extensions`
   (Developer mode → Load unpacked → the `brave-bridge/extension` folder), and
2. start the bridge: `node frontend/desktop/resources/brave-bridge/bridge.mjs`.
   Do not fall back to shell `open` or other browsers unless the user approves.

## Tools

- `cdp_status` — check the connection and list open tabs. Run this first.
- `cdp_navigate {url}` — load an absolute URL in the active tab.
- `cdp_get_text {selector?}` / `cdp_get_html {selector?}` — read page content.
- `cdp_eval {expression}` — run JavaScript in the page (supports `await`).
- `cdp_click {selector}` / `cdp_fill {selector, value}` — interact with elements.
- `cdp_screenshot` — capture the tab (returns a saved PNG path).
- `cdp_new_tab {url?}` / `cdp_list_tabs` — manage tabs.

## Guidance

- Start with `cdp_status`, then operate on the user's existing tab unless asked to
  open a new one. Prefer `cdp_get_text` / `cdp_eval` to read state before acting.
- This is the right surface for authenticated sites (the user's logins are already
  present). For throwaway/local pages a sandboxed browser tool is also fine.
