# Tables Manifest — controller @ `eeeb3406`

Literal `CREATE TABLE` scan across `controller/src/**` at `eeeb3406`. **Bounded static inventory, not a proven runtime schema**: runtime-composed DDL would classify unresolved — none found (all 11 definitions are string literals). **11 active tables** across 8 store files, plus the 9 `OBSOLETE_TABLES` listed separately: these are **dropped on open** (`controller/src/stores/sqlite.ts` sweeps them at startup — a destructive-on-open behavior Phase-2 acceptance row A13 targets; never point the controller at a real data dir for corroboration).

## Active tables (11)

| table | store file |
|---|---|
| controller_function_calls | controller/src/stores/controller-request-store.ts |
| controller_requests | controller/src/stores/controller-request-store.ts |
| controller_settings | controller/src/stores/controller-settings-store.ts |
| inference_requests | controller/src/stores/inference-request-store.ts |
| lifetime_metrics | controller/src/modules/system/metrics-store.ts |
| model_downloads | controller/src/modules/engines/downloads/download-store.ts |
| peak_metric_sessions | controller/src/modules/system/metrics-store.ts |
| peak_metrics | controller/src/modules/system/metrics-store.ts |
| recipes | controller/src/modules/models/recipes/recipe-store.ts |
| rigs | controller/src/stores/rig-store.ts |
| speech_voice_profiles | controller/src/modules/speech/voice-store.ts |

## OBSOLETE_TABLES (9) — dropped on open, `controller/src/stores/sqlite.ts:5`

| jobs | swept by the drop-on-open list at sqlite.ts:21 |
| chat_sessions | swept by the drop-on-open list at sqlite.ts:21 |
| chat_messages | swept by the drop-on-open list at sqlite.ts:21 |
| chat_runs | swept by the drop-on-open list at sqlite.ts:21 |
| chat_usage | swept by the drop-on-open list at sqlite.ts:21 |
| sessions | swept by the drop-on-open list at sqlite.ts:21 |
| messages | swept by the drop-on-open list at sqlite.ts:21 |
| runs | swept by the drop-on-open list at sqlite.ts:21 |
| usage | swept by the drop-on-open list at sqlite.ts:21 |
