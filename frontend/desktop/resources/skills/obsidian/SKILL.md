---
name: obsidian
description: Search, read, create, and append to the user's Obsidian markdown vaults with vault semantics.
---

# Obsidian

Tools edit vault files directly. Treat notes as private user writing: cite sources, read freely only for the task, and write only when asked. Optional `vault` selects a folder name/path; otherwise the open or recent vault is used.

## Tools

- `obsidian_vaults`: list vaults and default/open state.
- `obsidian_search`, `obsidian_recent`: find notes or recent previews.
- `obsidian_read`: body, frontmatter, tags, and resolved wikilinks.
- `obsidian_backlinks`: notes and lines linking to a note.
- `obsidian_create`: create only; never overwrite.
- `obsidian_append`: append only; never create.

Wikilinks resolve by note name across the vault; aliases/headings still target that note. Frontmatter is metadata. Tags combine frontmatter and inline tags. `.obsidian/` settings are excluded.

Search, then read before summarizing. Follow links/backlinks when needed. Ask before writing unless clearly requested. If create/append refuses, search and read rather than bypassing it. There is no delete or overwrite; say so. Match nearby conventions. With multiple vaults, list and pass one explicitly. If none exists, do not invent or create a notes folder.
