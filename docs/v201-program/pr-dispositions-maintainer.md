# Maintainer PR Dispositions — v2.0.1 Harvest Ledger (six frozen PRs)

Read-only audit lane (GLM-5.3, 2026-08-15 UTC) for the six maintainer PRs of the frozen 29-row census (`pr-inventory.md` §1): **#382, #396, #401, #403, #404, #407**, audited against candidate track **PR #408** (`feat/v201-consolidation` → `dev`) at head **`c0036a57d7e8c4d816d990bd0f9b1fc3a1f5fcbf`** (verified equal to this worktree's `HEAD` and to `origin/feat/v201-consolidation`). This file records dispositions only; it executes no harvest, mutates no PR, and closes nothing. Frozen census rows stay untouched; GOAL.md row 6.3 remains the closure authority.

**Fact classes.** *Snapshot* = `pr-inventory.md` census (2026-08-13T19:03:43Z) and `wp0-evidence.md` (2026-08-15). *Current* = re-fetched from GitHub plus re-verified in this worktree this session. Head SHAs of all six PRs are **unchanged since the census** (verified via `gh pr view --json headRefOid`); PR #408's head advanced past the wp0-evidence base `359510ae6` to `c0036a57d…`, so all overlap/patch evidence below was recomputed at the current head.

## 1. Identity and current state (all six re-fetched this session)

| PR | title | state/draft | head (full SHA, unchanged since census) | base | mergeable (current) | commits | +/−/files |
|---|---|---|---|---|---|---|---|
| #382 | docs: plan Local Studio performance program | OPEN / draft | `15bc8dd8bc2b4e97aa7b325bd952f43aad0ddb7d` | `dev` @ `88b56e36bd5c84930dbe364296ba4ae669f72689` | MERGEABLE | 25 | +3,906/−3/35 |
| #396 | refactor: halve Local Studio structural code | OPEN / draft | `c452af5cd77ded8997dc1de82d9453cf0e637529` | `main` @ `7f3814e1b2090b3d9b7598a2f67ee9819246dc3a` | CONFLICTING | 199 | +16,135/−31,572/455 |
| #401 | fix(agent): make Gmail OAuth work for consumer accounts | OPEN / ready | `edd5e4c8d89435b37ced158978483cf29320410b` | `dev` @ `a765eb27bca4baffabc6dc84c553fc6d8be5590d` | MERGEABLE | 6 | +741/−26/8 |
| #403 | Session performance, litter-bridge removal, models page redesign | OPEN / ready | `682b3b26c74ba3cae0a739e047b29bff6613cc50` | `main` @ `0f34634f3ed1bb47026f33063acf68d2f659fc71` | MERGEABLE | 33 | +4,106/−12,234/140 |
| #404 | feat(chat): render referenced media inline | OPEN / ready | `ad619062a5ac5864ac0762fc0842e3b54c5118ca` | `dev` @ `a765eb27bca4baffabc6dc84c553fc6d8be5590d` | MERGEABLE | 2 | +545/−50/11 |
| #407 | feat(agent): match Codex threads and scheduled tasks | OPEN / draft | `e254af450f318e9203362707b6cc6459efdd3a10` | `dev` @ `a765eb27bca4baffabc6dc84c553fc6d8be5590d` | MERGEABLE | 102 | +5,106/−15,813/144 |
| #408 | Local Studio v2.0.1 full convergence and release gate (candidate track) | OPEN / draft | `c0036a57d7e8c4d816d990bd0f9b1fc3a1f5fcbf` | `dev` @ `a765eb27bca4baffabc6dc84c553fc6d8be5590d` | MERGEABLE | — | +10,713/−16,562/350 vs `dev` |

## 2. Method (no secrets; read-only)

- PR metadata: `gh pr view <n> --json number,title,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,commits` (token never printed; `gh auth status` confirmed account `0xSero`).
- Diff/scope: `git diff --stat/--name-only <pr-base>..<pr-head>`; overlap vs #408 = `comm -12` of each PR's changed-file list against `git diff --name-only a765eb27…c0036a57d…`.
- Harvest proof: `git merge-base --is-ancestor <pr-head> c0036a57d…`; per-commit `git show <c> | git patch-id --stable` matched against `git log --no-merges <merge-base>..c0036a57d…`; content checks via `git ls-tree`/`git show`/`git grep` at the track head.
- Cross-references: `pr-inventory.md`, `wp0-evidence.md`, `pr-403-t4-pack.md`, `rulings.md` (G0B/G0C caps, G0K R30/R38), `GOAL.md` rows 0.2/6.3.

## 3. Per-PR findings and dispositions

### #382 — performance program plan → **selectively-port**

- **Purpose:** control plane for the 2026-08-09 performance campaign: `docs/workflow.md` (115 ln), `work/local-studio-performance-program/{scope,rules,status}.md` + 16 task files, contracts `shared/agent/session-identity.ts` (268 ln) and `controller/contracts/serving-state.ts` (417 ln), compute instance-store touch-ups, campaign evidence manifests, `AGENTS.md`/`.gitignore` pointers.
- **Harvested:** nothing. 0 of 18 non-merge commits patch-id-match the track; `docs/workflow.md`, `session-identity.ts`, `serving-state.ts`, and the whole `work/local-studio-performance-program/` tree are absent from `c0036a57d…`. Overlap with #408 is 5 files only (`.gitignore`, `AGENTS.md`, `gpu-leases.ts`, 2 test files).
- **Uniquely useful under GOAL.md:** `docs/workflow.md` is the missing authority file of row 1.11 (`AGENTS.md` still cites it at the track head; #408's own AGENTS.md edit kept the reference). `serving-state.ts`/`session-identity.ts` are design inputs for rows 1.8/3.4 — but gate-2 architecture adjudication is blocked (`wp0-evidence.md` §8), so they are inputs to the drafted packet in `decisions-pending.md`, not port-now code. `scope.md`'s verified findings (serving truth, cluster topology, vision pairing) already inform rows 1.8/5.4.
- **Must not port:** `controller/tests/serving-state-contract.test.ts` (+398), `controller/tests/compute-lifecycle.test.ts` changes, `services/agent-runtime/test/session-identity-contract.test.ts` (+289), `controller/tests/fixtures/serving-state-v1.ts` (no-tests law); the `AGENTS.md` campaign pointer (conflicts with GOAL.md row 0.4 sole-contract status); workflow.md must be reconciled first — it still mandates `npm run test:integration`, which the no-tests policy removed from #408's AGENTS.md.
- **Next proof before closure:** a reviewed commit landing a current `docs/workflow.md` (adapted from #382, gates reconciled) closing row 1.11, plus an adjudicated decision recording the serving-state/session-identity contracts' disposition for rows 1.8/3.4. Until both exist, #382 stays open.

### #396 — structural code halving → **selectively-port**

- **Purpose:** −31,572-line structural rewrite: controller re-founded on `engines/configs.ts` + `specs/backend-specs.ts`, canonical runtime snapshots/tool stores, centralized API/route policy, direct icon imports, page pass-through collapse; re-measured 93,506 code lines / 720 files under the frozen cloc pipeline (`wp0-evidence.md` §1).
- **Harvested:** nothing wholesale, by recorded intent. `wp0-evidence.md` §2 (GOAL rows 0.2/6.3) rules: no wholesale controller adoption — #396 is a different-but-equivalent controller (≈17,840 vs 18,085 ln excluding its retained speech) against heavy conflict (136 files also changed by #408; 319 untouched). Current state re-confirmed: CONFLICTING against `main`.
- **Uniquely useful:** frontend/services structural savings where the track carries more code (agent-runtime/src +3,511, agent/ui +2,373, agent/runtime +1,659, agent/workspace +1,205, agent root +883, agent/messages +880, shared/agent +778, recipes +457, agent/tools +441, desktop direct +429 — `wp0-evidence.md` §2 directory table). Even full adoption misses the row-1.1 target (≥23,711 more lines must go at the current head), so #396 is one input, not the path.
- **Must not port:** its retained TTS/speech code (3,162 + 413 ln; violates row 1.2 direction); its e2e-test commits and the `docs: require recorded e2e integration tests` policy (`5ff51222640b3d2c72bf6f116afa2b750ec5f696`, `83b2bf53b0e4501d82fc53b39f15f10f18fb6e64`, `97a731bfeac5200dde57ef5d5266da1de3d2992d`); its integrations/agent-runtime/http growth (+1,064/+528) without review.
- **Next proof before closure:** an executed per-directory harvest ledger (commits/paths ported, LOC delta under the frozen pipeline, behavior evidence for affected surfaces) plus a written rejection rationale for everything left behind; closure only after #408 acceptance.

### #401 — Gmail OAuth for consumer accounts → **selectively-port**

- **Purpose:** replace the Gmail MCP connector path (endpoint that fails for consumer accounts) with a direct Gmail REST API connector: new `services/agent-runtime/src/gmail-api-mcp.ts` (507 ln), `connector-pool.ts` gmail special-casing, `connectors-service.ts` legacy-endpoint acceptance, `google-account.ts` client-secret requirement, frontend setup/modal fixes, markup preservation and HTML-fallback tokenization.
- **Harvested:** nothing. 0 of 6 commits patch-id-match the track; `gmail-api-mcp.ts` absent from `c0036a57d…`; `connector-pool.ts` has no gmail branch (`git grep -i gmail` at the track head: no hit in that file); `google-workspace-binding.ts` lacks `legacyEndpoints`. Overlap with #408: 1 file (`google-account-modal.tsx`).
- **Uniquely useful:** the only consumer-account Gmail OAuth correctness fix in the open-PR set; the track still routes gmail through the generic MCP connector.
- **Must not port:** `services/agent-runtime/test/gmail-api-mcp.test.ts` (166 ln; no-tests law).
- **Next proof before closure:** the 5 non-test commits ported onto current track contracts (Effect/boundary rules apply) plus a live consumer-account OAuth + Gmail round-trip recorded in the installed app on disposable data; then close with port-commit evidence.

### #403 — session performance / bridge removal / models redesign → **fully-harvested-close-after-acceptance**

- **Purpose:** old-session tail paging (`loadEarlier`), rollout caches persisted across restarts, litter-bridge gateway removal, TTS removal, dictation, models-page Codex-pattern redesign, reasoning-level exposure.
- **Harvested: fully, with in-repo evidence.** `git merge-base --is-ancestor 682b3b26c74ba3cae0a739e047b29bff6613cc50 c0036a57d…` → true: the entire head is an ancestor of the track via merge **`2bcd73cc95084da727097b1406f95bdb74171c20`** (parents `05cde8ed58f9c94fd16d5835b608fc20dbf7bee8` + `682b3b26…`), pre-merge pack and R38 rulings in `pr-403-t4-pack.md`; repair **`02373e5f6204103942ee60da2f5c8606ec2c194a`** removed the two service tests; all 7 `.bench.ts` files kept and still present at the track head.
- **Post-harvest adaptations (deliberate, not losses):** `frontend/desktop/project.mjs` resolved to the track variant (`52c28a56` wins, R38); **`55d04ddadf9d9bb7056152a3a681bf8d3785ab66`** restored the litter-bridge gateway (+5,042 ln) because GOAL row 3.4 requires the Litter seam — so #403's "bridge removal" is intentionally un-done on the track; models-redesign work continues under row 2.5 (PARTIAL).
- **Uniquely useful remainder:** none — every commit of `0f34634f…682b3b26` is contained in the track; the only deltas are the R38-mandated test deletions and the row-3.4-mandated bridge restore.
- **Next proof before closure:** installed-app session-performance acceptance (row 3.6: last-turn-first, upward paging, cancellation/races, no whole-transcript rerender at the frozen build) and #408's merge into `dev` (row 6.2). Neither exists today, so #403 is **not safe to close yet**; when both land, close it individually citing `2bcd73cc9…`/`02373e5f…`.

### #404 — inline referenced media → **superseded-no-port**

- **Purpose:** stream local response media (`fs/raw` byte-range helper, fs-store byte reads) and render referenced media inline (`assistant-media.ts` 120 ln, markdown `img` override, chat.css).
- **Harvested:** nothing directly — and nothing should be. 0 of 2 commits patch-id-match the track; `assistant-media.ts` absent; the track's `assistant-markdown.tsx` still renders `[Remote image hidden]`; `fs-store.ts` still uses `readFileBytes`.
- **Superseded by #407's same-day evolved lineage:** `1501db9c635cb90c256c873cf730bc8184bc4be2` (streams the raw route with single-range 206 support, drops the whole-file 64 MB buffering), `b94f9084c8cd8171c40b99ce13761412d948dc9f` (inline render; its `assistant-media.ts` differs from #404's by 12 diff lines), plus three hardenings #404 lacks: `a65b0d342c3ccb83f80931b4f58d718d8f245fba` (validated media descriptor), `f7b33522319458cbcab5a641cbcba1e8f85feee1` (registered-project constraint), `bc6a476703c21455e0283f69a285fd63d94d7b36` (descendant-path requirement). #404 additionally carries `route.test.ts` + `assistant-media.test.ts` (no-tests law).
- **Next proof before closure:** the #407 media/security commits ported onto the track (or an equivalent reimplementation with the same confinement properties) with a path-confinement review; then close #404 citing the superseding commit evidence. Contingency: if the #407 media port is rejected in review, #404's byte-range approach becomes the fallback and this disposition must be re-adjudicated before any closure.

### #407 — Codex threads and scheduled tasks → **selectively-port**

- **Purpose:** Codex-parity shell plus chat-scoped automations: `Thread` canonical durable-conversation contract, durable thread owner, dedicated automation executor, thread-targeted scheduled tasks, dense scheduled-task rail and in-thread panel, plugins page and models marketplace, settings shell, media lineage (supersedes #404), TTS removal, transcript-cache fixes.
- **Harvested:** nothing by patch identity (sampled and media/litter-bridge/speech commits all NO-MATCH; the track did its own TTS removal and bridge restore independently). Confirms `wp0-evidence.md` §3: **port, do not merge.** Overlap with #408: 88 files changed by both, 56 untouched by #408.
- **Uniquely useful (row 2.2 core — NOT STARTED on the track):** `services/agent-runtime/src/automation-runner.ts` (268 ln: thread targeting, model resolution/fallback, archived/busy guards) — absent from the track; `frontend/src/features/agent/automations/thread-automation-panel.tsx` (237 ln) — absent; `shared/agent/automation.ts` 57→80 ln — track still identical to `dev` (57 ln); automations-feature rework +1,384/−528 across 9 files (track touched only a 1-line editor tweak and a test deletion in that tree). Also unique: plugins page, models marketplace cards (rows 2.5/2.8), the #404-superseding media lineage.
- **Must not port:** the 88-file overlap wholesale — #407 binds to its own era of pi-runtime/thread-repository/session APIs that #408 has since changed (drift depth unmapped); its own litter-bridge removal and speech deletion (already superseded on the track by #403-merge + row-1.2/3.4 work); its test files (`automation-scheduler.test.ts`, `automations-store.test.ts`, `automations.test.ts`, `automation-model.test.ts`).
- **Next proof before closure:** a per-commit port map reconciling the API drift onto current track contracts, live scheduled-task CRUD/execution/status proof per row 2.2, UI acceptance for ported surfaces, and #408 acceptance; then close citing the port commits.

## 4. Coverage and unresolved items

**Coverage: 6/6 maintainer PRs audited** (purpose, head/base/state, commits, paths, overlap, harvest status, unique value, no-port set, disposition, next proof). Fork-external PRs and #373/#395 are out of scope here (GOAL row 0.2 keeps them open for their own ledgers).

Unresolved:

1. No PR above is safe to close today: every "next proof" (rows 1.11, 2.2, 3.6 acceptance; OAuth round-trip; media port; #396 harvest execution; #408 merge) is outstanding.
2. Gate-2 architecture adjudication remains blocked (Fable-5 quota; OMP/DeepSeek 401 — `wp0-evidence.md` §8), which blocks any adoption of #382's `serving-state.ts`/`session-identity.ts` for rows 1.8/3.4.
3. #407→track API drift is acknowledged but not mapped commit-by-commit; the port map is a prerequisite, not a product of this audit.
4. #404's supersession is contingent on the #407 media port surviving review (fallback re-adjudication noted above).
5. #396's per-directory LOC savings are quantified at directory level only; the commit-level harvest ledger is future work.
6. Mergeability values are current-state facts and can drift; closures must re-fetch PR state immediately before acting (row 6.3 process).

## 5. Validation

- `git diff --check` — clean (no whitespace errors) with the new file staged.
- `npm run check` — **6 of 7 sub-gates green; one environmental failure** in `check:frontend`'s final packaging step. Green: `check:automation`, `check:contracts`, `check:structure`, `check:static`, `check:cleanup`, production `next build` (exit 0), `check:controller`, `check:agent-runtime`. Failure: `complete-standalone` (`frontend/desktop/project.mjs:677`) aborts with `ERR_FS_CP_EINVAL` — src and dest resolve to the same physical `typebox` directory. Root cause is pre-existing and unrelated to this docs-only change: this worktree's untracked `frontend/node_modules` is a symlink to `/Users/sero/projects/vllm-studio-v201/frontend/node_modules` (created 2026-08-14 by a prior lane), so `next build`'s output tracer emits `.next/standalone/frontend/node_modules` as a symlink to the same tree and the runtime-dependency `cpSync` collides with itself. Reproduced twice, including after removing the gitignored `.next` tree; the symlink is preserved untouched per the preserve-user-changes rule. Full `npm run check` must be re-run in a worktree with a real `frontend/node_modules` before any code-bearing handoff.
- Commit: single new file `docs/v201-program/pr-dispositions-maintainer.md`, conventional `docs(v201):` subject, pre-commit/commit-msg hooks run normally (docs-only staging: branch + 15-file/600-line cap checks; no hook bypass), nothing pushed.
