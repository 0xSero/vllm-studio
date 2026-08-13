# Sweeps

## R12c test-file sweep (post-`dcb790fd`)

Tracked `*.test.*` / `*.spec.*` at H0 (`dcb790fd`) after both repairs: **zero.** The forward guard matches test-file **basename globs** (`*.test.*` / `*.spec.*`) and classifies by **content**, never directory name alone.

- `frontend/src/app/api/agent/connectors/test/route.ts` — **allowlisted (retained).** Live `POST /api/agent/connectors/test` runtime route (App Router; imports `NextRequest`/`NextResponse`; `runtime="nodejs"`; performs live `probeConnector` work; returns `tool_count`/`tool_names`). "test" is a path segment naming a connector-connectivity probe, not test code.
- `services/agent-runtime/test/inkling-thinking-levels.test.ts` — **deleted** (`dcb790fd`); was inert (no `test` script, not in `tsconfig.build.json` `include`).

## GLM-Δ8 — audio/speech per-ref presence (C14 follow-through)

`app.ts` at `eeeb3406` imports **eight** register functions (compute, engines, system, models, proxy, studio, **audio, speech**). The dossier's "six registrars / no audio module" map was read at `262f84c7` on the *unmerged* #403 lineage. Per-ref presence (all equal → audio/speech are live on the track):

| ref | audio dir | speech dir | `app.ts` audio import | `app.ts` speech import | audio route rows | speech route rows |
|---|---|---|---|---|---|---|
| `eeeb3406` (main) | yes | yes | 3 | 3 | 2 (`/v1/audio/transcriptions`, `/v1/audio/speech`) | 7 |
| `a765eb27` (dev) | yes | yes | 3 | 3 | 2 | 7 |
| `dcb790fd` (H0) | yes | yes | 3 | 3 | 2 | 7 |

**Flag to DeepSeek:** every TTS/speech disposition in Phase 2 must be re-established against the **track tree**, not the dossier. The audio/speech surfaces are live across main/dev/H0; the C4 "no TTS surface" finding is lineage-relative and does not apply on the consolidation track.

## C14 — registrar correction (recorded)

Registrar topology is tree-relative. The "six registrars" note was a `262f84c7` reading; the `eeeb3406` truth is **eight** top-level register imports + sub-registrars (19 files with route definitions — see `baselines/routes-eeeb3406.md`).
