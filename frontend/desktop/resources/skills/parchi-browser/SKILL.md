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

## Workflow

1. Create a workspace once before using the browser relay.
2. Navigate to the requested URL.
3. Read text or screenshot before acting when page state matters.
4. Prefer selectors for click/fill. Use coordinates only when selectors are unavailable.
5. Report relay errors directly and retry with a narrower action when appropriate.
