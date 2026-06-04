---
name: computer-use
description: "Control macOS desktop apps — click, type, scroll, drag, and read on-screen UI. Use for any task that needs to operate native Mac applications."
---

# Computer Use (vLLM Studio)

vLLM Studio's own desktop-control surface (original implementation; no third-party
helper). Use it to operate native macOS apps when a task can't be done from the
shell or a browser tool.

## How it works

- Every action returns a fresh **screenshot** plus a short **accessibility
  snapshot** of the target app. Read those before deciding the next action.
- Target apps by **name** or **bundle id** (e.g. `Finder`, `com.google.Chrome`).
  Pass `app` so the right window is focused first.

## Tools

- `list_apps` — see what's running.
- `get_app_state {app}` — indexed accessibility tree of an app's UI (each line is
  `[index] Role Title`). Use the index with `click`/`set_value`.
- `click {app, x, y}` or `click {app, element_index, button}` — click a pixel point
  or a UI element. `button` may be `left` (default), `right`, or `middle`.
- `type_text {app, text}` — type into the focused field.
- `press_key {app, key}` — a key or combo, e.g. `return`, `cmd+a`, `ctrl+shift+t`.
- `scroll {app, direction, pages}` — `up`/`down`/`left`/`right`.
- `drag {app, from_x, from_y, to_x, to_y}` — drag between two pixel points.
- `set_value {app, element_index, value}` — set a field's value directly.
- `perform_secondary_action {app, element_index, action}` — context/secondary action.

## Guidance

- Prefer `get_app_state` + `element_index` for reliable targeting; fall back to pixel
  coordinates from the screenshot when an element isn't exposed.
- Take one action at a time and re-read the returned screenshot before continuing.
- Requires macOS **Accessibility** and **Screen Recording** permission for the
  vLLM Studio process. If actions silently do nothing, that permission is missing.
