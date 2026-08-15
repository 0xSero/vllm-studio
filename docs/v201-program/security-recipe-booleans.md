# Strict recipe boolean evidence

Status: production port and static gate complete; installed UI acceptance pending.

## Provenance and scope

- Accepted convergence base: `a5813610f6490f560b54f58cc61a18b5bed5ca75`.
- Source: PR #361, `[Security] Parse recipe booleans strictly`, production commit `03f0898f706458e351ffec46e3114b488706d835` by `fettpl <38704082+fettpl@users.noreply.github.com>`.
- Ported product commit: `2939d9cff8c8175d6cd92f857efebeee91534d7a`, with the source author's authorship preserved.
- The production-file diffs for the source and port have the same stable patch ID, `1c3d9b596fd24cc9233c72ee18f80a5972604c73`.
- Production scope: `controller/src/modules/models/recipes/recipe-serializer.ts` only. The port replaces truthiness coercion for `trust_remote_code` and `enable_auto_tool_choice` with Effect Schema decoding of an optional JSON boolean, retaining the existing omitted-field defaults.
- Excluded by program policy: `controller/src/modules/models/recipes/recipe-serializer.test.ts`, `controller/tests/http-app.test.ts`, and all fixtures. No automated test code was added, restored, or run.

## Legacy persisted-data scan

The scan used SQLite URI `mode=ro` plus `PRAGMA query_only=ON`. It selected only recipe counts and aggregate `json_type` classifications for the two boolean fields; no recipe IDs, model paths, environment variables, credentials, or full JSON payloads were read into the evidence. No existing database was opened by a mutating controller.

| Persisted location | Recipes | `trust_remote_code` | `enable_auto_tool_choice` | Result |
|---|---:|---|---|---|
| Stable installed data, `~/Library/Application Support/Local Studio/controller.db` | 0 | none | none | No legacy recipe rows |
| Dev installed data, `~/Library/Application Support/Local Studio Dev/controller.db` | 0 | none | none | No legacy recipe rows |
| Current repository data, `/Users/sero/projects/vllm-studio/data/controller.db` | 12 | 12 booleans, 0 missing, 0 non-booleans | 12 booleans, 0 missing, 0 non-booleans | Compatible |
| Legacy `local-studio-2` data | n/a | n/a | n/a | Database has no recipe JSON column |

No persisted non-boolean value was found in the current locations. This is an inventory result, not a migration guarantee for databases on other machines.

## Disposable controller probe

The manual endpoint probe ran the ported controller on loopback port `19161` with an isolated data directory, missing model directory, metrics disabled, and no model launch. Only disposable recipe IDs and the two boolean fields were printed.

| Scenario | Result |
|---|---|
| Omit both fields under the normal environment | HTTP 200; persisted `trust_remote_code=true`, `enable_auto_tool_choice=false` |
| Send explicit `false` for both fields | HTTP 200; both values persisted as `false` |
| Send explicit `true` for both fields | HTTP 200; both values persisted as `true` |
| For each field send `null`, `"true"`, `"false"`, `0`, `1`, `[]`, or `{}` | HTTP 400 with `Invalid <field>`; no rejected row persisted |
| Fetch a rejected recipe ID | HTTP 404 |
| Restart with `LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE=false`, then create an omitted-field recipe | Existing rows survived; new recipe persisted `false/false` |
| Restart again without the override | Explicit-false, original-default, and disabled-default values remained unchanged |

After the second restart the disposable database held four accepted rows, and all four stored JSON booleans for both fields. The isolated controller was stopped. Its data directory and controller log were moved to Trash as the lane's own recoverable cleanup; no current user data was changed.

## Effective engine arguments

A pure vLLM launch-plan probe used the parsed explicit-false recipe without spawning an engine. The effective argv contained the normal model, listen, context, memory, and concurrency arguments and contained neither `--trust-remote-code` nor `--enable-auto-tool-choice`. This confirms the false-valued probe does not become a truthy launch flag in the standard no-parser path.

## Validation and remaining gap

- `cd controller && bun run typecheck`: PASS before the product commit.
- Root `npm run check`: PASS. The final transcript is `/tmp/localstudio-v201-recipe-booleans-check-r3.log`, SHA-256 `352f8b34b927dc34d785c6bb1da8eaffb744a778c069777d7bb23c017b5d860f`; it reached all six top-level gates and ended after the agent-runtime build.
- Installed Dev app recipe editor and command-preview acceptance: NOT RUN. This port has controller/API and launch-plan evidence only; it must not be presented as installed UI proof.
