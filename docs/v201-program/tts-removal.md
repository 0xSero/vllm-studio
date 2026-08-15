# WP 1.2 — Text-to-speech removal ledger

Lane: GLM-5.3 implementation lane, branch `codex/v201-remove-tts-20260814`, base `c0036a57d` (2026-08-14).
Scope: GOAL row 1.2 — Local Studio does not use text-to-speech. This pass audits and removes only proven-dead TTS synthesis / voice-profile product residue. STT dictation, audio upload, media rendering, and the `realtime.session` shared multimodal seam are preserved.

## 1. TTS inventory at the frozen main baseline (`eeeb3406`)

Per the frozen cloc 2.06 shards in `docs/v201-program/baselines/loc/main-eeeb3406/`, TTS product code at main was 24 files, 5,569 code lines:

| Area | Files (code lines) |
|---|---|
| Controller contracts | `contracts/speech.ts` (43) |
| Controller speech service | `src/modules/speech/{service,runtime,worker-client,voice-store,voice-vault,storage,reference-audio,routes}.ts`, `worker.py` (3,373) |
| Controller standalone TTS service | `src/services/tts.ts` (107) |
| Controller audio routes | `src/modules/audio/{routes,helpers,interfaces}.ts` (455; `POST /v1/audio/speech` TTS + transcription forwarding) |
| Frontend API client | `src/lib/api/speech.ts` (331) |
| Frontend voice UI | `src/features/integrations/chatterbox-voice-*.tsx/ts` (1,239) |
| Bundled voice plugin | `desktop/resources/plugins/chatterbox-voice/**` (21) |

All 24 files are absent from the current track. The removal landed before this lane in `fe0d8196e` (chatterbox TTS), `3fe2dde4c` (Chatterbox voice surface), `adc4728b9` (`POST /v1/audio/speech`), `1347cacac` (audio body limits), and `89f0e6582` (speech module and TTS service). This lane found zero surviving TTS synthesis, voice-profile, TTS-provider, or TTS-route code by full-tree scan (case-insensitive `tts|text-to-speech|speech|voice|chatterbox|speak|utterance|speechSynthesis` over `controller/`, `frontend/src`, `frontend/desktop`, `services/`, `shared/`, `scripts/`, packaging, and every `package.json`).

## 2. False-positive classes verified and preserved

- `watts`/`powerWatts`/`nextTs` contain the substring `tts`; all GPU-power and ESLint-config matches are unrelated.
- `realtime-status-*` hooks are dashboard model/status polling, not voice.
- Agent-runtime `voiceUrl`/`voiceModel` settings (below) are STT-era, not TTS.

## 3. Residue removed by this lane

| Path | Change | Why proven dead |
|---|---|---|
| `frontend/desktop/electron-builder.yml` | `NSMicrophoneUsageDescription` rewritten from "Record your own voice to create a private, local voice profile." to "Record audio for local dictation." | The voice-profile (voice cloning) feature no longer exists anywhere in the tree; the microphone entitlement itself remains in active use for STT dictation. |
| `README.md` | Dropped `audio` from the proxy capability list and removed the nonexistent `src/modules/audio` diagram node/edge. | The controller proxy serves only `/v1/chat/completions`, `/v1/count-tokens`, `/v1/tokenize-chat-completions`; `controller/src/modules/audio/` does not exist. |
| `controller/README.md` | Dropped `audio` from the capabilities bullet; removed `modules/audio` and `Audio --> Speech["STT/TTS integrations"]` diagram nodes. | Same evidence; controller has no speech/audio surface (STT lives in `services/agent-runtime`). |
| `frontend/README.md` | `src/features/integrations/` description no longer lists "speech". | The integrations feature contains only google-account, model-providers, plugins, and skills. |
| `controller/src/modules/compute/bridge.ts` | Header comment no longer claims the legacy port preserves "speech surfaces". | No speech surface exists. |
| `controller/src/modules/compute/contracts.ts` | `pinned` device-hold doc no longer cites the removed speech worker / lease shim. | The speech worker and GPU lease registry were removed with the speech service; the generic `pinned` variant itself remains in live use by `lifecycle.ts`. |
| `controller/src/modules/system/gpu-visibility.ts` | Removed the header paragraph narrating the removed `"speech"` GPU-lease owner. | Historical narration of deleted code, no current referent. |

## 4. Preserved surfaces (explicitly not TTS)

- **STT dictation (retained, live):** `frontend/src/features/agent/ui/composer-dictation-button.tsx`, `use-composer-dictation.ts`; agent-runtime routes `/api/agent/transcribe` and `/api/agent/transcribe/engine` (`transcribe-handlers.ts`, `local-transcribe.ts`), 25 MB multipart cap. Local-dictation design recorded in `3780f153f`.
- **Audio upload and media rendering (retained):** dictation recording upload; audio attachment rendering in `chat-attachments` and `user-message-block`.
- **`realtime.session` shared seam (retained):** `shared/agent/litter-bridge.ts` realtime schemas and `shared/agent/litter-bridge-realtime-v1.fixture.json` cover provider-native OpenAI Realtime and local-pipeline audio/text WebRTC signaling — a cross-repo seam and general multimodal capability, not TTS-only product code. A lane-local, unpushed removal attempt (`140f25f8c`, −464 lines, unreachable from any published ref) was fully restored to base `c0036a57d` after adjudication; no seam change is shipped here. Any future seam change requires the paired Litter PR and joint acceptance per GOAL "Repository ownership".
- **Remote-STT settings remnant (retained, dead, routed to row 1.3):** `services/agent-runtime/src/settings-service.ts` persists `voiceUrl`/`voiceModel` (env `VOICE_URL`/`VOICE_MODEL`, default `whisper-large-v3-turbo`). Born in `3e55a4220` as a server-auth remote transcription proxy (`/api/voice/transcribe`, STT); the fields are still emitted on `GET`/`POST /api/settings` and `voiceUrl` is still validated on update, but there is no UI or dictation consumer for them. Left in place because they are STT-flavored, not TTS residue; flagged for the row 1.3 dead-config sweep as an API response-shape removal.
- **PR #396 disposition:** its head `c452af5c` still retains 20 TTS-related files from its own branch state (controller speech module, `contracts/speech.ts`, Chatterbox plugin and frontend surfaces, `lib/api/speech.ts`) but not the main-era `src/services/tts.ts` or the deleted audio-route mix. It contains no TTS deletions to port; the current track is strictly ahead on row 1.2.

## 5. Database residue — disposition required by the migration workpack (row 1.9)

- `speech_voice_profiles` was created by main's `controller/src/modules/speech/voice-store.ts` (encrypted local voice profiles). The creating code is gone; the table name has zero references in the current tree and is **not** a member of `OBSOLETE_TABLES` in `controller/src/stores/sqlite.ts`, so every database created by main-era builds retains the orphaned table indefinitely.
- Required disposition (owned by row 1.9, not this lane): a versioned migration that drops `speech_voice_profiles` with a rollback path, applied under the row 1.9 migration/rollback architecture once accepted. This lane deliberately did **not** add the table to the destructive open-time `OBSOLETE_TABLES` sweep and did not implement any migration machinery.
- Restart-persistence proof against a copied database remains open under row 1.9's own gates.

## 6. Product-LOC accounting (frozen GOAL methodology)

Frozen pipeline (`docs/v201-program/baselines/method.md`, pinned cloc 2.06 `ed9fbdd0…`, identical scope/extension/exclusion filters):

| Ref / state | Files | Code LOC | Comment lines |
|---|---|---|---|
| Lane base `c0036a57d` (before) | 791 | 104,378 | 4,166 |
| Lane head (after) | 791 | 104,378 | 4,161 |

Reproduced `SUM` row before: `791,SUM,8357,4166,104378`; after: `791,SUM,8357,4161,104378`. This lane's changes are documentation, comment, and packaging-text corrections: code LOC is unchanged (−5 comment lines; the YAML string replacement is line-neutral). The row 1.2 LOC reduction itself — the 24 files / 5,569 code lines in section 1 — landed in prior commits and is already reflected in the 104,378 base; PR #396 contributes nothing to it.

## 7. Validation

- `git diff --check`: clean.
- Full `npm run check` (automation layout, contracts, structure, frontend `check:quality` incl. lint/typecheck/build/desktop packaging gates, controller typecheck+lint+standards audit, agent-runtime build): **pass**.
- Environment note (pre-existing, proven at base): this worktree's `frontend/node_modules` is a symlink into `/Users/sero/projects/vllm-studio-v201/frontend/node_modules`. With that symlink, Next's standalone output re-symlinks `node_modules` back to the same real path and `desktop/project.mjs complete-standalone` fails `cpSync` with `ERR_FS_CP_EINVAL` (src==dest, `typebox`) — reproduced identically on the untouched base via `git stash`. The green check above was produced with a temporary real `frontend/node_modules` (`npm ci`); the symlink was restored verbatim afterward, leaving the shared environment untouched.

## 8. Remaining acceptance gaps (row 1.2 not yet `DONE`)

1. Exact-build installed regression on the packaged, signed, installed Electron app (mic dictation still works; no TTS/voice UI anywhere) — owned by the row 5.x/6.x installed-app gates.
2. `speech_voice_profiles` migration/drop decision and copied-database restart proof — owned by row 1.9.
3. Dead `voiceUrl`/`voiceModel` settings fields — owned by row 1.3 dead-config sweep.
4. No Litter-side action is required by this lane: the shared seam is untouched.
