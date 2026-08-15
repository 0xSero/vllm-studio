# TTS-remnant follow-up evidence

Date: 2026-08-15

Base: `370b7aa29175b904fb81537f98748de1c8b03858`

Product head: `9cd746c2f`

## Scope and result

This follow-up removes three independently proven-dead surfaces without changing live dictation or shared realtime audio contracts:

- `800b78391` removes the unused `voiceUrl` and `voiceModel` settings, their four environment aliases, URL validation, persistence, and public response fields. Existing settings files with the old keys remain readable; the keys are ignored and are omitted on the next write.
- `175767ece` removes the unused frontend and runtime `GET /api/agent/transcribe/engine` routes, their handler, and the duplicate engine resolver. `POST /api/agent/transcribe`, its 25 MB limit, local engine selection, ffmpeg conversion, and transcript result remain.
- `9cd746c2f` removes the unimported `AudioLines` and `Volume2` icon exports.

Full production-tree scans after the three commits find no `voiceUrl`, `voiceModel`, associated voice environment aliases, transcription-engine route/handler/resolver, `AudioLines`, or `Volume2` references. The same scans confirm the composer client still posts to `/api/agent/transcribe`, the runtime still registers that POST handler, `transcribeLocally` remains wired, and `realtime.session` remains in the shared Litter bridge contract and fixture.

## Disposable behavior probes

The settings probe used an isolated pre-seeded temporary data directory and two separate Bun processes. It established:

- Environment defaults produce only `backendUrl` and `apiKey`; the public view contains only `backendUrl`, masked `apiKey`, and `hasApiKey`, even when all removed voice environment aliases are set.
- A partial update containing the two removed legacy keys ignores them and persists only `backendUrl` and `apiKey`.
- The persisted file mode is `0600`.
- A fresh process prefers persisted backend and API-key values over changed environment defaults.
- A masked API-key update preserves the stored key, and an invalid backend URL still raises `InvalidSettingsError`.

The route probe instantiated the runtime Hono app without starting a listener:

| Request | Result |
|---|---|
| `GET /api/agent/transcribe/engine` | `404` |
| malformed JSON `POST /api/agent/transcribe` | `400`, multipart-body validation message |
| empty multipart `POST /api/agent/transcribe` | `400`, required-file validation message |

All temporary probe data was removed after the run.

## Focused gates

- `npm --prefix services/agent-runtime run build`: PASS. TypeScript build completed and the postbuild rewrote 180 relative specifiers and wrote the server shim.
- `npm --prefix frontend run check:static`: PASS. Lint, frontend/desktop/extension type checks, cycle scan, and UI structure gate passed. The existing `ComposerProjectDrawer` complexity warning remained non-failing.
- Independent source review of `370b7aa29..9cd746c2f`: GO. The reviewer confirmed the six-path boundary, preserved POST/pick-engine/ffmpeg/transcript flow, unchanged backend/API-key masking and atomic `0600` save semantics, inert legacy voice keys, and zero-consumer route/icon removals.
- `git diff --check`: PASS.
- No automated tests were added or run. The root `npm run check` was intentionally held for the combined integration gate.

## Product LOC

The frozen cloc 2.06 method in `docs/v201-program/baselines/method.md` was applied to the exact base and product head.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| `370b7aa29` | 819 | 8,435 | 3,943 | 105,209 |
| `9cd746c2f` | 818 | 8,428 | 3,892 | 105,166 |
| Delta | -1 | -7 | -51 | -43 |

The 43-code-line reduction is: settings 14, frontend engine route 10, runtime engine handler 8, duplicate resolver 8, runtime registrar 1, and icon exports 2. Raw Git change is 6 files, 3 insertions, and 104 deletions.

External evidence: `/Users/sero/projects/vllm-studio-v201-evidence/tts-remnants-20260815/`

| Artifact | SHA-256 |
|---|---|
| `production-files-base-370b7aa29.txt` | `7c942e33457cce135e2c035d93620134c81049f22c45e002e8b0c6d6a28a1c65` |
| `production-files-head-9cd746c2f.txt` | `c51952c2e7dbdd34c03063f63f7693d70da7c1a5b03e9d4a1d05b4301de184c3` |
| `cloc-base-370b7aa29.csv` | `d839aa28acd5fb5f3f39d9fd7b96b22fa604d6f6aa331b2df949a59a28bd8e63` |
| `cloc-head-9cd746c2f.csv` | `209ab42209af32eae04e119d5a5ed7abb5cd5985eecec2e1dfb777677f304861` |

## Remaining acceptance gap

Source and package gates do not prove installed dictation. The exact integrated build still needs packaging and installation followed by a real microphone-permission, recording, local-engine, ffmpeg, transcription, composer-insertion, restart, and no-TTS/voice-UI regression run. The orphaned installed-database `speech_voice_profiles` migration remains a separate row 1.9 decision; this follow-up does not touch database schema or migration code.
