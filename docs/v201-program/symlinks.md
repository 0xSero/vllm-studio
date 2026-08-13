# Symlinks — GLM-Δ7

All 4 symlinks tracked at H0 (`dcb790fd`) and their resolution + ownership. Physical-target ownership governs edits (the symlink aliases are not separate physical files).

| symlink (tracked path) | readlink | resolves to (physical) | physical owner lane |
|---|---|---|---|
| `scripts/project.mjs` | `../frontend/desktop/project.mjs` | `frontend/desktop/project.mjs` | GLM (`frontend/**`) |
| `.githooks/commit-msg` | `../scripts/project.mjs` | `frontend/desktop/project.mjs` (transitive) | GLM |
| `.githooks/pre-commit` | `../scripts/project.mjs` | `frontend/desktop/project.mjs` (transitive) | GLM |
| `.githooks/pre-push` | `../scripts/project.mjs` | `frontend/desktop/project.mjs` (transitive) | GLM |

`core.hooksPath = .githooks` is set at the repo; all three hook entry points dispatch through the single `frontend/desktop/project.mjs` implementation (the symlinked `scripts/project.mjs`). The G0B merge-exemption edit touched exactly that physical file. No other symlinks are tracked at H0.
