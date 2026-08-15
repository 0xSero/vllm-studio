# Decisions Pending

Open items, watch items, and quarantines. Fable adjudicates; nothing here is acted on without a ruling.

## B1–B4 status

- **B1 — CI workflow definitions verbatim.** Closed by R32/P9 A4: the canonical verbatim archive (sha256-fingerprinted `ci.yml`/`release.yml`/`maintenance.yml`/`release.config.cjs` at `eeeb3406`) and structural digests live in `release-path.md`. That archive is time-scoped to `eeeb3406` — the track has since evolved `ci.yml` (commit-lint `--mode=ci`) and the live PR rollup now shows nine checks — so re-audit live before release-time reliance.
- **B2 — branch protections/rulesets for `dev`/`main`; Release run dispositions.** Closed by R32/P9 A4 (`release-path.md`): classic protections tabled, rulesets empty, Release #464 `waiting@sign` and #463 `cancelled` recorded. Protection settings are GitHub-side facts; re-audit live when required check names or workflow behavior change.
- **B3 — `prod` remote unreachable.** `ser@192.168.1.70` SSH timeout during fetch (known; recorded as evidence, not chased).
- **B4 — (reserved for items surfaced during the program).** None currently.

## Watch items (non-blocking)

- **dev carries the old `inkling-thinking-levels.test.ts` + its old tsconfig.** If dev modifies it before the final PR merge, the server-side merge surfaces a modify/delete conflict — resolved by deletion under the same law. Noted so nobody improvises later.
- **`AGENTS.md` cites the absent `docs/workflow.md`** (C3) — pending. The Codex integration-owner ruling (recorded 2026-08-14; this is a Codex ruling, not a Fable adjudication): `AGENTS.md` plus GOAL row 1.11 justify restoring one current workflow authority instead of retaining the inline-flow workaround. Durable lane proof: tmux session `localstudio-v201-workflow-glm53-20260814-r1`, Pi/ZAI model `zai/glm-5.3`, session `F02DC088-F5BB-4599-B9D0-DEC1BF178EE0`, assigned worktree `/private/tmp/localstudio-v201-workflow-authority` on branch `codex/v201-workflow-authority-20260814`, base `c0036a57d7e8c4d816d990bd0f9b1fc3a1f5fcbf`, candidate `550f4fb7f449397b32e78df38ccc0fde7b384c42` plus the correction `e93074bdeadf07f44017aa85a1ba29b06cc6f7e3`, `npm run check` exit 0, Opus-5 r1 review verdict REVISE with every medium and actionable low finding corrected, and Opus-5 r2 re-review at `e93074bdeadf07f44017aa85a1ba29b06cc6f7e3` returning APPROVE with no high/medium findings. Final resolution waits for the lane push, integration into `feat/v201-consolidation`/PR #408, and re-verification of the citation on the merged ref.
- **LOC target ≤ 80,667** (25% of 107,556). GOAL-era head `359510ae6` measures **104,378** (791 files, frozen pipeline re-run 2026-08-15); PR #396 head `c452af5c` measures 93,506; remaining cut −23,711 — ledger at `wp0-evidence.md` §1. The shrink is harvest-plus-deletion-inventory work, not Phase 0.

## Quarantine

- **`/tmp/litter-v201-pi`** is a dossier for the separate **Litter** repository (`0xSero/litter`, the mobile app) — out of scope (Q1/C4). It is **never ingested** into this Local Studio ledger; its owner-class/path-ownership data does not apply here. It is **not deleted** (standing no-delete rule). One line only; see `pr-inventory.md` §3.
- **Session JSONLs are volatile.** Load-bearing evidence is serialized into this ledger or the Fable plan at ruling time (G0H2 durability lesson). The partial `d15844d9` Fable-session PR-number set is **not census evidence**.

## Resolved this phase (recorded for traceability)

- **Routes manifest** — G0G/R23: whole-tree static scan replaces R19's "six registrar files" phrasing; controller.md §5 not tracked at `eeeb3406`; optional runtime corroboration is DeepSeek/Phase-2 (not exercised).
- **PR census** — G0H/G0H2/R25′: frozen 29-row snapshot census stands; the historical "30" is `unresolved-historical`/`unresolved-benign` (prose arithmetic; empty 18:26–19:03Z archaeology probe).

## DRAFT — awaiting Fable and OMP/DeepSeek adjudication: GOAL row 0.7 topology packet (multi-model, arbitrary-port controller)

Status: **DRAFT — awaiting Fable and OMP/DeepSeek adjudication.** This packet defines the questions and a provisional shape for gate 2; it is (P) proposal only, not an authorized architecture decision, and it approves nothing. Adjudication is currently blocked: the fresh Fable-5 lane is quota-blocked and the required OMP/OpenRouter DeepSeek-v4-pro lane is authentication-blocked (`GOAL.md` row 0.8). Grounding facts (instance store, lifecycle, supervisor, bridge, 12 singleton touchpoints) are (C) and recorded in `wp0-evidence.md` §§5–7; rows 1.6/1.7/1.8 implementation may not start under this draft. Alternatives and unresolved decisions are preserved per topic; nothing here is binding.

### 1. Canonical deployment identity

- Question: what is the unit of serving identity — instance, model, or port?
- Provisional: the named deployment record (`InstanceRecord.name`) is the identity; engine, model, and recipe attach to the record (already the store key).
- Alternatives: identity = model id with implicit one-instance-per-model naming; identity = port number.
- Unresolved: naming scheme for auto-launched instances (the bridge's fixed `LLM_INSTANCE = "llm"` name is the legacy case); alias/renaming rules; max instances per model.

### 2. Model-to-instance routing

- Question: how does a request carrying `model` find its upstream instance and port?
- Provisional: resolve model → instance record via the instance store, then the record's port; delete the `buildInferenceUrl`/`fetchInference` singleton hard-bind (`local-fetch.ts:59-70`); remote providers keep the existing `provider/model` prefix routing (`services/provider-routing.ts`).
- Alternatives: route via the recipe registry only; explicit instance-selection header/param on the API.
- Unresolved: behavior when several instances expose the same model alias (error vs deterministic pick vs explicit selection); whether `gateOnRunningModel`'s single-model 503 gate becomes per-instance or is removed.

### 3. Exact/dynamic port allocation and collision handling

- Question: what are the exact-port and dynamic-allocation semantics, and what happens on collision?
- Provisional: keep the store's proven semantics — upward scan from per-engine base ports, dual-interface (127.0.0.1 + 0.0.0.0) bind probe, `exactPort` reservation that hard-fails on collision, placement lock (O_EXCL lock file, pid-staleness reaping, 25 ms retry / 5 s timeout).
- Alternatives: OS-assigned (port 0) ephemeral ports recorded after bind; a global port broker.
- Unresolved: port-range policy per engine; whether dynamic allocations persist across restart; the bind-probe race window and who is authoritative.

### 4. GPU leases

- Question: who owns a GPU while multiple instances run?
- Provisional: leases derived from the instance record set (existing), with shareable unified-memory devices remaining shareable.
- Alternatives: explicit lease objects with TTLs; a central scheduler.
- Unresolved: eviction policy when VRAM is exhausted; cross-engine fairness; whether a failed launch holds its lease during retry.

### 5. Persistence

- Question: what survives controller restart?
- Provisional: one JSON record per named deployment, write-then-rename (crash-safe, existing).
- Alternatives: sqlite-backed records (interacts with row 1.9); no persistence (re-derive from config).
- Unresolved: retention of exited-instance records; garbage-collection policy; schema versioning of the record itself.

### 6. Health/readiness

- Question: what does "ready" mean per instance, and how is it surfaced?
- Provisional: the existing lifecycle states (`reserving/starting/ready/unhealthy/exited`) with `waitReady`, surfaced per instance through the multi-instance compute API (`/compute/instances...`).
- Alternatives: engine-specific readiness payloads; a single aggregated health resource.
- Unresolved: readiness vs first-token probe semantics per engine; unhealthy thresholds; who re-probes.

### 7. Crash/restart recovery

- Question: how do crashed instances and stale locks recover?
- Provisional: existing supervisor reaper (2 s) plus `stateOf` checks; pid-staleness reaping of placement locks (existing).
- Alternatives: auto-restart with backoff; manual-only recovery.
- Unresolved: auto-restart vs mark-unhealthy policy; orphan-process adoption after controller crash; restart storm protection.

### 8. Cancellation and errors

- Question: per-instance cancel/error semantics under multi-port.
- Provisional: keep the per-instance cancel flag and 20 s stop grace; preserve client-abort → 499 mapping and upstream SSE error frames; stop/launch remain per instance name.
- Alternatives: global cancel-all; bounded-concurrency launch queue.
- Unresolved: cancel propagation into in-flight streams per instance; cleanup ordering on partial failure (port reserved, process spawned, never ready).

### 9. Backwards-compatible singleton bridge migration

- Question: how do current single-port surfaces keep working while routing migrates?
- Provisional: retain `compute/bridge.ts` as a read-compatibility shim over one designated instance (the `"llm"` record) until proxy/metrics/models/status surfaces migrate; non-flag-day sequence — additive routes first, routing second, legacy-path removal last, each step probe-gated before the next deletes anything.
- Alternatives: hard cut with a contract bump; a temporary translation proxy in front of the instance store.
- Unresolved: shim lifetime and retirement criteria; which surfaces migrate first; whether the shim is read-only or also accepts launches.

### 10. Public contract v2

- Question: how do `contracts/system.ts` shapes (`ServiceInfo.inference_port`, `SystemConfig.inference_port`, `EnvironmentInfo.inference_url`) become multi-port without breaking consumers?
- Provisional: additive v2 — per-instance entries (name, model, engine, port, state) alongside deprecated single-port fields, with an explicit removal date only after consumers migrate.
- Alternatives: breaking v2 namespace; leaving single-port fields as "instance[0]" aliases forever.
- Unresolved: additive-fields vs versioned-namespace strategy; enumeration of every downstream consumer (frontend, litter-bridge seam) before any change — the shared seam requires paired PRs and one joint acceptance recording per `GOAL.md`.

### 11. Metrics/models/tokenization/status routing

- Question: which singleton-port surfaces follow the instance, and how?
- Provisional: every touchpoint in `wp0-evidence.md` §5 resolves its target through instance records; `/v1/models` merges live models across all running instances; metrics/tokenization/status accept an instance or model target.
- Alternatives: aggregate-only endpoints plus explicit per-instance query params; per-instance sub-paths.
- Unresolved: metrics cardinality/labeling; benchmark targeting; which of the 12 touchpoints migrate in which wave.

### 12. Responses/Anthropic ordering (rows 1.6/1.7)
- Question: do the new passthroughs land before, after, or with de-singleton routing?
- Provisional: type the passthrough contracts first (`controller/contracts/` Schema sets shared by chat/Responses/Anthropic), land `/v1/responses` and Anthropic Messages additively, then route all three through instance resolution together — no legacy path deleted until its replacement passes probes.
- Alternatives: de-singleton first, then passthroughs; all three in one wave.
- Unresolved: final ordering rests with gate-2 adjudication; both new passthroughs must resolve upstream per instance from day one if they land after routing.

### 13. Database migration safety (row 1.9 interaction)

- Question: what must be true in the DB layer before topology changes ship?
- Provisional: versioned migrations (`PRAGMA user_version` + `schema_migrations` registry + backup-before-mutate) proven on a copied database, replacing the drop-on-open sweep; explicit disposition for every table including orphaned `speech_voice_profiles`; destructive drops only via versioned migration with rollback.
- Alternatives: keep sweep + add missing tables to the list (rejected direction per GOAL row 1.9, preserved for completeness).
- Unresolved: which tables carry data forward vs drop; rollback depth; whether instance records (topic 5) ever live in sqlite.

### 14. Live acceptance

- Question: what proves the topology on real engines?
- Provisional: gate-4 matrix on disposable data — simultaneous vLLM and SGLang (plus llama.cpp/MLX where available) on distinct arbitrary ports, an exact-port collision negative test, cancel/error/stream/tool fidelity per instance, restart persistence, and the ≤25 ms p95 loopback passthrough budget measured per engine before and after routing changes; unavailable engines get an explicit recorded disposition; raw remote endpoints stay in private evidence.
- Alternatives: single-engine proof first; lab-stub engines (not acceptable for final gate).
- Unresolved: frozen engine/model/version probe set; measurement harness ownership; where raw probe evidence is archived.
