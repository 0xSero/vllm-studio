# Sitegeist Browser Relay

Use this skill when the user asks you to inspect, navigate, click, fill, screenshot, or extract content from a webpage through the sitegeist browser relay.

## Tools

- `sitegeist_navigate`: open an absolute http(s) URL.
- `sitegeist_get_url`: return the current URL and title.
- `sitegeist_get_text`: read visible page text (optionally scoped to a selector).
- `sitegeist_get_html`: read rendered HTML (optionally scoped to a selector).
- `sitegeist_screenshot`: capture the page or an element.
- `sitegeist_click`: click a selector, or a viewport coordinate.
- `sitegeist_fill`: set a form field value (optionally submitting).
- `sitegeist_scroll`: scroll the page or an element by a pixel delta.
- `sitegeist_eval`: evaluate a JavaScript expression in the page context.
- `sitegeist_tabs_list` / `sitegeist_tabs_new` / `sitegeist_tabs_switch` / `sitegeist_tabs_close`: manage tabs.

## Workflow

1. Navigate to the requested URL.
2. Read text or screenshot before acting when page state matters.
3. Prefer selectors for click/fill. Use coordinates only when selectors are unavailable.
4. Use `sitegeist_eval` for page-side scripting and inspection.
5. Report relay errors directly and retry with a narrower action when appropriate.
