# Integrity — Primary Checkout Six-Vector

The dirty primary checkout `/Users/sero/projects/vllm-studio` must remain byte-identical to the Phase-0 backup through the whole program. The six hash values (5 modified tracked files + 1 untracked), transcribed from the durable backup (R21):

| file | sha256 | status |
|---|---|---|
| `frontend/src/app/styles/globals/tokens.css` | `964d1d91ffef2a0eadcf7b296534fbe62c50c7ff93dcfb3d3790f04ccaf88071` | modified (tracked) |
| `frontend/src/features/agent/ui/projects-nav/nav-chrome.tsx` | `c2068fa81a32615aad207f447b2a34baa908064868953a6dab6eaef6a178f364` | modified (tracked) |
| `frontend/src/features/agent/ui/projects-nav/session-rows.tsx` | `c4aad40396012f802617b8196b38192247b5c7bca6f24f2c0e6aadcecc399c4f` | modified (tracked) |
| `frontend/src/features/shell/left-sidebar.tsx` | `b7c510a4107ddc79797442741cbd5d2113647d4cd9f518981837206ae9041da7` | modified (tracked) |
| `frontend/src/store.ts` | `360576aea10c81d2a07b99b65bf364d9d3429ae76e2fff7e321f0e9972e79a4e` | modified (tracked) |
| `controller.md` | `ee27dd814f98cdc37ad68ef1a2c3a641c80f6c7b288d352999a7225bbd7c7359` | untracked (copy in `03-untracked/copies/`) |

Full 865-tracked + 1-untracked checksum manifests: `01-status/before-tracked.sha256`, `01-status/before-untracked.sha256` in the backup. Unstaged patch 6947 B (`02-patches/unstaged.patch`); staged patch 0 B.

## T7 re-check rows (append after each program step)

| when | HEAD | branch | status lines | six-vector | verdict |
|---|---|---|---|---|---|
| 2026-08-13 (backup capture) | `262f84c7` | `feat/drawer-git-and-steer-pending` | 6 (5 M + 1 ??) | baseline recorded | OK |
| 2026-08-13 (post-`dcb790fd`, DS re-gate) | `262f84c7` | same | 6 | 6/6 MATCH | OK |
| 2026-08-13 (G0F P4 authoring, pre-push) | `262f84c7` | same | 6 | 6/6 MATCH | OK |
