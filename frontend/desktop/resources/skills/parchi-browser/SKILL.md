# Parchi Browser Relay

Use this skill when the user asks you to inspect, navigate, click, fill, screenshot, or extract content from a webpage through the Parchi browser relay.

## Tools

- `parchi_create_workspace`: create or attach a Parchi browser workspace for this session.
- `parchi_navigate`: open a URL in Parchi.
- `parchi_get_text`: read visible page text.
- `parchi_screenshot`: capture the current page.
- `parchi_click`: click a selector or coordinates.
- `parchi_fill`: fill a selector with text.
- `parchi_repl`: run small browser-side JavaScript when direct inspection is needed.
- `parchi_node_repl`: Sitegeist-compatible `node_repl` alias for sandboxed browser/session JavaScript. Use this for loops, scraping, data processing, multi-step browser workflows, and prompts that explicitly ask for `node_repl`.
- `parchi_tool_call`: call any relay command when a dedicated wrapper is missing. Useful commands include `mouse.click`, `hover`, `focus`, `check`, `uncheck`, `select`, `press`, `wait`, `eval`, `get`, `is`, `snapshot`, `findHtml`, `pdf`, `console`, `errors`, `network.watch`, `network.requests`, `record.start`, and `record.stop`.

## Workflow

1. Create a workspace once before using the browser relay.
2. Navigate to the requested URL.
3. Read text or screenshot before acting when page state matters.
4. Prefer selectors for click/fill. Use coordinates only when selectors are unavailable.
5. Use `parchi_node_repl` for Sitegeist-style scripting prompts and for work that needs iteration across the page.
6. Use `parchi_tool_call` for full screen/page control that is not covered by the named wrappers.
7. Report relay errors directly and retry with a narrower action when appropriate.
