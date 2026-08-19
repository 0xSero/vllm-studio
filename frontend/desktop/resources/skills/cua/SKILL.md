---
name: cua
description: Computer use — drive a browser to open, read, interact with, and remember web pages. Load when the user asks to browse, search, open a page, inspect a link, fill a form, or when live web content matters.
---

# cua — computer use

One `browser_*` toolset drives whichever browser Local Studio is configured for. The tool names are identical either way; only the extras differ.

**Embedded (default).** A headless Chromium-family browser on this machine — Chromium, Chrome, or Brave, whichever the user picked in the Browser panel. Throwaway profile: no saved logins, no extensions, no downloads, one page at a time. Only public `http(s)` URLs and localhost are reachable. The user can watch it live in the Browser panel. When no browser binary is available the runtime degrades to a read-only fetch of the page instead of failing.

**Sitegeist relay.** The user's real browser window, with their real profile and logins. Everything you do is visible to them and can affect signed-in accounts. Adds `browser_eval` and tab management. If the relay or extension is not running, the tools fail immediately — say so plainly rather than guessing at page content.

## Tools

- `browser_navigate` — open an absolute `http(s)` URL and wait for load.
- `browser_get_url` — where the browser actually is right now.
- `browser_get_text` — visible page text. The default way to read a page.
- `browser_get_html` — rendered HTML, when you need selectors or attributes.
- `browser_screenshot` — PNG data URI, when visual layout matters.
- `browser_click` / `browser_fill` — act on a CSS selector.
- `browser_scroll` — pixel delta, for lazy-loaded content.
- `browser_back` / `browser_forward` / `browser_reload` — embedded only.
- `browser_eval`, `browser_tabs_list` / `_new` / `_switch` / `_close` — sitegeist only.
- `browser_history` — what this computer has already done and visited.

## Protocol

1. Navigate first, then read. Do not summarize a page you have not read this turn.
2. Read with `browser_get_text`. Reach for `browser_get_html` only when text is not enough, and `browser_screenshot` only when layout matters and the model has vision.
3. Before repeating work, call `browser_history` — on the embedded backend it also shows pages the user opened in the panel, so it is the honest answer to "where are we".
4. A `found: false` from click or fill means the selector was wrong. Re-read the page and pick a new selector instead of retrying the same one.
5. If a tool reports the browser is unavailable or the relay is down, tell the user in one line. Never claim to have opened or inspected a page you could not reach.
6. Never enter credentials, payment details, or other secrets unless the user supplied them for that exact site in the current turn. On the sitegeist backend the browser is already signed in as the user — do not take account actions they did not ask for.
