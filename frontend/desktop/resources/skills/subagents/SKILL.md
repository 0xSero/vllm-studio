---
name: subagents
description: Delegate independent work to parallel child sessions when tasks split into self-contained chunks.
---

# Subagents

A child has fresh context, the same project and tools, and only its task text. Up to four run at once; children cannot spawn children. Use them for independent research, reviews, implementations, or alternatives, not small sequential work.

## Tools

- `subagent`: spawn a child and wait up to 15 minutes; concurrent calls fan out.
- `subagent_list`: list this session's children and run ids.
- `subagent_status`: read one child's state and available report.
- `subagent_stop`: stop a child and return partial work.

Give each child a clear name and a standalone task with paths, expected report, and constraints. Split files to avoid edit races. Start independent calls together. If a wait expires, check its id rather than respawning. Stop only unneeded work. Resolve conflicts and synthesize reports before answering.
