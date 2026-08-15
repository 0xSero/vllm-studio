# Combined post-small-fix checkpoint

Date: 2026-08-15

Status at seal time: the local source checkpoint was mechanically green but not yet pushed, covered by hosted CI, packaged, installed, visually accepted, or release-accepted. Later publication evidence must be recorded separately rather than backfilled into this immutable gate record.

## Exact provenance

- Shared source refs: `origin/main` `eeeb3406d4bcef255b6405c5508fb324d5e38e77`; `origin/dev` `a765eb27bca4baffabc6dc84c553fc6d8be5590d`.
- Remote `origin/feat/v201-consolidation` and PR #408 head: `370b7aa29175b904fb81537f98748de1c8b03858`.
- Exact local product head: `6f5c77a6d5fd47125652c24f0dccbd58a9c5cc0a`.
- Exact pre-gate ledger head: `bd380f108a34bfe6e201a925d2137387a85ce801`. The local root gate ran at this tree; its product bytes are exactly `6f5c77a6d`.
- PR #408 is OPEN, DRAFT, MERGEABLE, and CLEAN. At remote head `370b7aa29`, all nine contexts are successful: gates, controller, agent-runtime, frontend, desktop-package, Secret Scanning, CodeQL Analysis, Dependency Review, and CodeQL.

The local commits after `370b7aa29` were not on the remote branch or in those hosted runs when this checkpoint was sealed.

## Integrated local stack

| Boundary | Product commits | Evidence commit | Result |
|---|---|---|---|
| PR #362 platform-job metadata P2 | `2977b63c233f73ca5a78f053b5509d27a02772e7` | `cdead91f2e3507211dfb8ea8fd641f1e4c368f55` | Shared backend identity is typed once; CUDA/ROCm jobs retain truthful backend identity; unsupported platform installs expose no fictional command; platform update and managed-engine behavior remain unchanged. |
| TTS remnants | `5b01a2f010fd1b7a0deed68a6df52cc33a941cb3`, `930e19c75409832fcf6629bf11e99f6e1f6a38a0`, `a2b88412a0d24a7eeafedd578471f08d96f73670` | `fc6789919244270ba37b57e5cabd37d888f42632` | Removes dead voice settings, the unused transcription-engine probe, and orphaned audio icon exports while preserving POST dictation, ffmpeg conversion, engine selection, and the shared realtime seam. Frozen product-code delta is −43. |
| PR #271 notice placement | `fcf57a9d9b1b80db41a0e456d078bc94c2223df1` | `bd380f108a34bfe6e201a925d2137387a85ce801` | Workspace notices clear the composer and are toolbar-relative with the accepted layer and selector. Live visual acceptance remains open. Frozen product-code delta is +3. |
| PR #269 controller credentials | `8a653d0823cacf66cb7c31e868da49e4bc62cc45`, `6f5c77a6d5fd47125652c24f0dccbd58a9c5cc0a` | `bd380f108a34bfe6e201a925d2137387a85ce801` | A matching keyless loopback request receives the current Settings key only in memory; inherited credentials are not persisted; rotation is observed on refresh; unrelated controllers remain keyless; explicit keys remain authoritative and persistent. Frozen product-code delta is +27. |

The credential slice initially failed independent review because inherited Settings keys were persisted and could become stale after rotation. Product `6f5c77a6d` corrected that lifecycle, and exact-tip re-review returned GO with no P0, P1, or P2 finding. The accepted PR #269/#271 source commits preserve the underlying proposal author; their prohibited automated-test changes were excluded.

## Combined root gate

Both attempts ran `npm run check` against unchanged exact tree `bd380f108`.

The first attempt reached frontend typechecking and exited 2 only because the existing ignored `.next` tree still contained generated route types for the now-removed `/api/agent/transcribe/engine` source route. This was a stale build-artifact mismatch, not a product-source diagnostic. The stale `.next` tree was moved by exact path recoverably to Trash; no tracked source changed.

The second attempt passed every required stage: automation layout, shared contracts, structure, frontend lint and typechecks, cycle and UI structure checks, production build, standalone repair and assertion, controller typecheck/lint/cleanup/standards, and agent-runtime build/postbuild. The frontend emitted only the pre-existing non-fatal `ComposerProjectDrawer` complexity warning. No automated test code was added, restored, modified, or run.

| Attempt | Exit | Transcript SHA-256 | Exit-marker SHA-256 |
|---|---:|---|---|
| R1, stale `.next` route types | 2 | `6a5dcc4184849be7b87bac261478f5724ea4c83bc2c74f14bce5233d78616776` | `299f178db501aaad2468b7e456f67cf4a7b99796e0c0edb116ddad22b8eff8c5` |
| R2, unchanged source after artifact cleanup | 0 | `cb6448cfa3b4e58f0a37a4057d7fbdb7abb62b1c157f4d227b12d0505d441207` | `b062b3c089764a1bd60774cb563b3ef64ef9abfbe560662f37a094cae9d496c5` |

## Frozen product LOC

The pinned cloc 2.06 method from `baselines/method.md` was applied at the checkpoint. Evidence and ledger files, generated output, vendored sources, and prohibited test-deletion credit remain excluded.

| Ref | Files | Blank | Comment | Code |
|---|---:|---:|---:|---:|
| Frozen baseline | — | — | — | 107,556 |
| Target | — | — | — | ≤80,667 |
| Local product `6f5c77a6d` / tree `bd380f108` | 818 | 8,429 | 3,866 | 105,208 |

The checkpoint is 2,348 code lines below the frozen baseline and remains 24,541 lines above the target. The TTS reduction and #269/#271 increase net with the PR #362 metadata repair to one fewer product-code line than remote head `370b7aa29`; no PR-diff or comment deletion is treated as product simplification.

| Artifact | SHA-256 |
|---|---|
| `production-files-bd380f108.txt` | `c51952c2e7dbdd34c03063f63f7693d70da7c1a5b03e9d4a1d05b4301de184c3` |
| `cloc-bd380f108.csv` | `106c6a79346c22245560c15034ddced5b23ca45423b53c5eab9f5eadacaf8224` |

Persistent artifacts are under `/Users/sero/projects/vllm-studio-v201-evidence/combined-post-small-20260815/`.

## Remaining acceptance boundaries

- Push the accepted local descendants and require all nine hosted contexts at their exact head.
- Build, sign, install, and bind the desktop artifact to the accepted source SHA before any installed-runtime claim.
- Exercise PR #271 notice placement in the live installed UI across composer, toolbar, popover, narrow-window, and error/setup-warning states.
- Exercise PR #269 through a real agent session and Settings-key rotation in the installed app; the disposable public-handler probe is source evidence, not installed proof.
- Run platform-job operations against the accepted installed controller/toolchain.
- Run a real microphone/dictation flow and prove no TTS/voice UI regression.
- Continue the frozen LOC reduction from 105,208 to at most 80,667 without weakening required behavior.
- Complete the separate Configure-retirement implementation, architecture, browser, performance, and paired Litter/mobile gates. This checkpoint does not change the bidirectional session-sync ruling: NOT READY.
