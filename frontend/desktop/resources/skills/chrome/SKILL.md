---
name: chrome
description: Use the user's visible signed-in Chrome profile, tabs, and sessions through the extension relay.
---

# Chrome

`chrome_*` acts in the user's real browser with their cookies and identity; actions are visible and may be public. Use `browser_*` for public signed-out browsing. The two do not share state.

## Tools

- `chrome_navigate`, `chrome_get_url`: open or identify the active page.
- `chrome_get_text`, `chrome_get_html`, `chrome_screenshot`: read private tab content.
- `chrome_click`, `chrome_fill`, `chrome_scroll`, `chrome_eval`: act in its authenticated origin.
- `chrome_tabs_list`, `chrome_tabs_new`, `chrome_tabs_switch`, `chrome_tabs_close`: manage real tabs.
- `chrome_history`: this tool's actions, not the user's browsing history.

Inspect URL/tabs first and prefer a new tab over disrupting their work. Read by default. Click, fill, evaluate, post, buy, send, or delete only when explicitly requested. Ask before destructive actions such as delete, revoke, cancel, unsubscribe, merge, or force-push. Never enter credentials or payment data. Keep private content within the requested task. If the relay fails, say so and use the sandbox only for public content.
