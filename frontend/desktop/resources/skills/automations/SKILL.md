---
name: automations
description: Manage Local Studio scheduled prompts: create, inspect, edit, pause, run, or delete recurring work.
---

# Automations

Automations share the app's Automation store. Fresh runs cannot see this chat, so make prompts self-contained. A `sessionId` continues that thread; `sessionId: ""` returns to fresh runs.

## Tools

- `list_automations`: list ids, schedules, status, next run, and last outcome.
- `read_automation`: read configuration and the last 20 runs.
- `schedule_automation`: create one.
- `update_automation`: change its name, prompt, schedule, model, directory, or session.
- `set_automation_status`: pause or resume it.
- `run_automation_now`: run now and wait for the outcome.
- `delete_automation`: permanently remove it and its history.

Schedules use local time: `{ kind: "interval", minutes: 30 }` (minimum 1), `{ kind: "daily", time: "08:00", weekdaysOnly: true }`, or `{ kind: "weekly", day: 1, time: "09:30" }` (Sunday=0). Use 24-hour `HH:MM`.

List before using an opaque id. Prefer update over replacement to retain history. Test important changes with `run_automation_now`; completion can still report failure. Pause unless permanent deletion is explicit. Confirm the schedule, next run, and fresh/continued session in plain words.
