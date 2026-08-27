---
name: cua
description: Browse and interact with public live web pages in a signed-out headless sandbox.
---

# Sandbox browser

`browser_*` uses one throwaway page with no profile, login, cookies, extensions, or downloads. It reaches public HTTP(S) and localhost and may fall back to read-only fetch. For the user's signed-in pages or existing tabs, use `chrome_*`; if absent, say Chrome is not armed and point to the composer browser button. Never treat a signed-out page as their account.

## Tools

- `browser_navigate`, `browser_get_url`: open and locate pages.
- `browser_get_text`, `browser_get_html`, `browser_screenshot`: read text, markup, or layout.
- `browser_click`, `browser_fill`, `browser_scroll`: interact by selector or scroll.
- `browser_back`, `browser_forward`, `browser_reload`: navigate history.
- `browser_history`: tool and Browser-panel activity this session.

Navigate and read this turn before summarizing. Prefer text; use HTML for selectors and screenshots for visual layout. On `found: false`, reread instead of retrying. Never enter credentials or payment details. Report unavailable pages honestly; do not invent content.
