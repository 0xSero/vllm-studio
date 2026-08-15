# WP 1.2 — Text-to-speech removal ledger

Lane: GLM-5.3 implementation lane, branch `codex/v201-remove-tts-20260814`, rebased onto canonical authority head `a5813610f6490f560b54f58cc61a18b5bed5ca75` (2026-08-14, after the Opus-5 REVISE corrections).
Scope: GOAL row 1.2 — Local Studio does not use text-to-speech. This pass audits and removes only proven-dead TTS synthesis / voice-profile product residue. STT dictation, audio upload, media rendering, and the `realtime.session` shared multimodal seam are preserved.

## 1. TTS footprint at the frozen main baseline (`eeeb3406`)

All counts below are derived from the pinned cloc 2.06 manifests in `docs/v201-program/baselines/loc/main-eeeb3406/` (code lines, blanks/comments excluded). Raw diff-deletion line counts from the removing commits are given in parentheses where they differ, since `git show --stat` counts every deleted line including blanks and comments. Two scopes are declared and kept distinct throughout:

**Scope A — TTS synthesis/product footprint: 24 files, 5,569 manifest code lines.**

| Area | Files (manifest code lines) |
|---|---|
| Controller synthesis service | `src/services/tts.ts` (107; 114 raw lines deleted by `fe0d8196e`) |
| Controller contracts | `contracts/speech.ts` (43) |
| Controller speech service | `src/modules/speech/{service,runtime,worker-client,voice-store,voice-vault,storage,reference-audio,routes}.ts`, `worker.py` (3,373) |
| Controller audio routes | `src/modules/audio/{routes,helpers,interfaces}.ts` (455; `POST /v1/audio/speech` TTS + transcription forwarding) |
| Frontend API client | `src/lib/api/speech.ts` (331) |
| Frontend voice UI | `src/features/integrations/chatterbox-voice-*.tsx/ts` (1,239) |
| Bundled voice plugin | `desktop/resources/plugins/chatterbox-voice/**` (21) |

**Scope B — broader controller speech/lease substrate removed with it: 26 files, 5,913 manifest code lines** (Scope A plus the following, all deleted by `fe0d8196e`):

| File | Manifest code lines (raw deleted) | Role |
|---|---|---|
| `controller/src/services/stt.ts` | 130 (139) | Remote STT service adjacent to the speech platform |
| `controller/src/modules/system/gpu-leases.ts` | 214 (263) | GPU lease registry whose only non-LLM owner was the speech worker |

All 26 files are absent from the current track. The removal landed before this lane in `fe0d8196e` (chatterbox TTS, `tts.ts`, `stt.ts`, `gpu-leases.ts`), `3fe2dde4c` (Chatterbox voice surface), `adc4728b9` (`POST /v1/audio/speech`), `1347cacac` (audio body limits), and `89f0e6582` (speech module and TTS service). This lane found zero surviving TTS synthesis, voice-profile, TTS-provider, or TTS-route code by full-tree scan (case-insensitive `tts|text-to-speech|speech|voice|chatterbox|speak|utterance|speechSynthesis` over `controller/`, `frontend/src`, `frontend/desktop`, `services/`, `shared/`, `scripts/`, packaging, and every `package.json`).

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

Three controller source files (`compute/bridge.ts`, `compute/contracts.ts`, `system/gpu-visibility.ts`) carry header comments that still narrate the removed speech surfaces. By integrator ruling this slice re-authors no source comments: those files are byte-for-byte identical to `a5813610` and the final TTS diff does not touch them.

## 4. Preserved surfaces (explicitly not TTS)

- **STT dictation (retained, live):** `frontend/src/features/agent/ui/composer-dictation-button.tsx`, `use-composer-dictation.ts`; agent-runtime routes `/api/agent/transcribe` and `/api/agent/transcribe/engine` (`transcribe-handlers.ts`, `local-transcribe.ts`), 25 MB multipart cap. Local-dictation design recorded in `3780f153f`.
- **Audio upload and media rendering (retained):** dictation recording upload; audio attachment rendering in `chat-attachments` and `user-message-block`.
- **`realtime.session` shared seam (retained):** `shared/agent/litter-bridge.ts` realtime schemas and `shared/agent/litter-bridge-realtime-v1.fixture.json` cover provider-native OpenAI Realtime and local-pipeline audio/text WebRTC signaling — a cross-repo seam and general multimodal capability, not TTS-only product code. A shared realtime-seam removal was attempted locally in this lane, rejected by scope adjudication, and fully restored before any push; no seam change ships here. Any future seam change requires the paired Litter PR and joint acceptance per GOAL "Repository ownership".
- **Remote-STT settings remnant (retained, dead, routed to row 1.3):** `services/agent-runtime/src/settings-service.ts` persists `voiceUrl`/`voiceModel` (env `VOICE_URL`/`VOICE_MODEL`, default `whisper-large-v3-turbo`). Born in `3e55a4220` as a server-auth remote transcription proxy (`/api/voice/transcribe`, STT); zero consumers today (no reader of either field; dictation is local). Left in place because it is STT-flavored, not TTS residue; flagged for the row 1.3 dead-config sweep.

## 5. PR #396 disposition (re-derived)

Counted against this ledger's declared scopes at PR #396 head `c452af5c`:

- Against the pre-correction 23-file list: 396 retains **22 of 23**; the single absent file is `controller/src/modules/audio/interfaces.ts`, deleted by 396's own `947c05146`. The earlier lane claim of "20 retained, no TTS deletions to port" undercounted and was wrong about deletions.
- Against Scope A (24 files): 396 retains **22 of 24**. Beyond `interfaces.ts`, `controller/src/services/tts.ts` is also absent — deleted by 396's `42980a192` together with `stt.ts`, but that commit **replaced** them with a new 225-line `controller/src/services/audio-cli.ts`; it unified the speech CLI boundary, it did not remove TTS. Against Scope B (26 files) 396 retains 23 of 26 (`gpu-leases.ts` retained).
- 396's head therefore still carries the entire TTS product surface: the speech module, `contracts/speech.ts`, `audio/routes.ts` + `helpers.ts` + `audio-cli.ts`, the Chatterbox plugin, the Chatterbox frontend surfaces, and `lib/api/speech.ts`. Supported conclusion unchanged: the current track is strictly ahead on row 1.2 because it removes that entire surface, and 396 offers no TTS deletion worth porting — its two file deletions are internal refactors into files this track deleted wholesale.

## 6. Database residue — disposition required by the migration workpack (row 1.9)

- `speech_voice_profiles` was created by main's `controller/src/modules/speech/voice-store.ts` (encrypted local voice profiles). The creating code is gone; the table name has zero references in the current tree and is **not** a member of `OBSOLETE_TABLES` in `controller/src/stores/sqlite.ts`, so every database created by main-era builds retains the orphaned table indefinitely.
- Required disposition (owned by row 1.9, not this lane): a versioned migration that drops `speech_voice_profiles` with a rollback path, applied under the row 1.9 migration/rollback architecture once accepted. This lane deliberately did **not** add the table to the destructive open-time `OBSOLETE_TABLES` sweep and did not implement any migration machinery.
- Restart-persistence proof against a copied database remains open under row 1.9's own gates.

## 7. Product-LOC accounting (frozen GOAL methodology)

Frozen pipeline (`docs/v201-program/baselines/method.md`, pinned cloc 2.06 `ed9fbdd0…`, identical scope/extension/exclusion filters). Section 1's Scope A/B totals come from the same pinned manifests at `eeeb3406` (5,462 for the original 23 files + 107 `tts.ts` = 5,569 Scope A; + 130 + 214 = 5,913 Scope B).

| Ref / state | Files | Code LOC | Comment lines |
|---|---|---|---|
| Authority base `a5813610` (before) | 791 | 104,378 | 4,166 |
| Lane head (after) | 791 | 104,378 | 4,166 |

`SUM` rows: before `791,SUM,8357,4166,104378`; after `791,SUM,8357,4166,104378`. This lane's final diff is documentation text plus one packaging string: code and comment LOC are unchanged (the YAML string replacement is line-neutral; markdown is outside the frozen scope). The row 1.2 LOC reduction itself — Scope A's 24 files / 5,569 manifest code lines (Scope B: 26 / 5,913) — landed in prior commits and is already reflected in the 104,378 base; PR #396 contributes nothing to it.

## 8. Validation

- `git diff --check` (working tree and full `a5813610..HEAD` range): clean.
- Full `npm run check` (automation layout, contracts, structure, frontend `check:quality` incl. lint/typecheck/build/desktop packaging gates, controller typecheck+lint+standards audit, agent-runtime build): **pass**, re-run after the rebase at the final head.
- Environment note (pre-existing, proven at the pre-rebase base): this worktree's `frontend/node_modules` is a symlink into `/Users/sero/projects/vllm-studio-v201/frontend/node_modules`. With that symlink, Next's standalone output re-symlinks `node_modules` back to the same real path and `desktop/project.mjs complete-standalone` fails `cpSync` with `ERR_FS_CP_EINVAL` (src==dest, `typebox`) — reproduced identically on the untouched base via `git stash`. The green check was produced with a temporary real `frontend/node_modules` (`npm ci`); the symlink was restored verbatim afterward, leaving the shared environment untouched.

## 9. Remaining acceptance gaps (row 1.2 not yet `DONE`)

1. Exact-build installed regression on the packaged, signed, installed Electron app (mic dictation still works; no TTS/voice UI anywhere) — owned by the row 5.x/6.x installed-app gates.
2. `speech_voice_profiles` migration/drop decision and copied-database restart proof — owned by row 1.9.
3. Dead `voiceUrl`/`voiceModel` settings fields — owned by row 1.3 dead-config sweep.
4. Stale speech narration inside three controller header comments — retained byte-for-byte per integrator ruling; any rewording belongs to a comment-policy decision outside this slice.
5. No Litter-side action is required by this lane: the shared seam is untouched.
