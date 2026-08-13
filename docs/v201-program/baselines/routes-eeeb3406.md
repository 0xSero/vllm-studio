# Routes Manifest — controller/src @ `eeeb3406` (static extraction)

**This is a bounded static inventory, not a proven exact runtime route table.** It is a whole-tree static pattern scan of `controller/src/**` from the `git archive eeeb3406` export (no curated file list, so registrar-count drift can never silently narrow the scan), using frozen pattern set P (see `method.md`): `defineRoutes(`, `mergeRoutes(`, `documentRoute(`, Hono verb calls `.get( `.post( `.put( `.patch( `.delete( `.all( `.on(`, and mount forms `app.route(`/subapp mounts. The eight register imports in `app.ts` seed the wiring trace, not the scan scope. Scan totals: **211 verb-call hits** across controller/src; **89 rows carry a path-shaped string literal on the route-app receiver `app`** — all 89 paths are string literals, so the `<dynamic>` rule (non-literal paths emit `<dynamic>` + verbatim source expression, never an invented resolution) has **zero instances at this ref**. The remaining 122 hits are non-route receivers (`store.get(…)`, `child.on("error")`, `Effect.*`, …) and are excluded by the inclusion rule. No `.route(` mounts and no `.all(` registrations exist at this ref.

**Classification counts:** static-wired **87** · library-emitted **2** (`/api/spec`, `/api/docs` — explicit `app.get` calls serving library content via `openAPIRouteHandler`/`swaggerUI`) · dynamic-unresolved **0** · mount **0** · static-unwired **0**. Wiring chain = `app.ts` import → register call → merged sub-registrar; every row below traced (no `unestablished` chains).

**Cross-checks recorded, never silently merged:** (1) dossier route map was read at tree `262f84c7` on the *unmerged* #403 lineage and claims six registrars / no audio module — differences are **expected** (C14: at `eeeb3406`, `app.ts` imports **eight** register functions incl. audio and speech; both modules carry live route rows here and at `a765eb27` and H0 per GLM-Δ8 in `sweeps.md`). (2) in-tree `controller.md` §5 is **not tracked at `eeeb3406`** (untracked primary-checkout file); cited as unavailable-at-ref. Runtime corroboration (`routes-eeeb3406.runtime.md`) is optional, DeepSeek/Phase-2, not exercised now.

| method | path | file:line | wiring chain | classification | notes |
|---|---|---|---|---|---|
| GET | `/api/docs` | controller/src/http/app.ts:130 | app.ts (direct assembly) | library-emitted | explicit app.get serving library content (openAPIRouteHandler / swaggerUI) |
| GET | `/api/spec` | controller/src/http/app.ts:110 | app.ts (direct assembly) | library-emitted | explicit app.get serving library content (openAPIRouteHandler / swaggerUI) |
| POST | `/benchmark` | controller/src/modules/system/metrics-routes.ts:218 | app.ts → registerSystemRoutes → registerMonitoringRoutes | static-wired |  |
| GET | `/compat` | controller/src/modules/system/routes.ts:112 | app.ts → registerSystemRoutes | static-wired |  |
| GET | `/compute/devices` | controller/src/modules/compute/routes.ts:69 | app.ts → registerComputeRoutes | static-wired |  |
| GET | `/compute/engines` | controller/src/modules/compute/routes.ts:77 | app.ts → registerComputeRoutes | static-wired |  |
| GET | `/compute/instances` | controller/src/modules/compute/routes.ts:87 | app.ts → registerComputeRoutes | static-wired |  |
| POST | `/compute/instances/:name/cancel` | controller/src/modules/compute/routes.ts:137 | app.ts → registerComputeRoutes | static-wired |  |
| POST | `/compute/instances/:name/stop` | controller/src/modules/compute/routes.ts:127 | app.ts → registerComputeRoutes | static-wired |  |
| POST | `/compute/launch` | controller/src/modules/compute/routes.ts:95 | app.ts → registerComputeRoutes | static-wired |  |
| GET | `/config` | controller/src/modules/system/routes.ts:237 | app.ts → registerSystemRoutes | static-wired |  |
| GET | `/events` | controller/src/modules/system/logs-routes.ts:322 | app.ts → registerSystemRoutes → registerLogsRoutes | static-wired |  |
| POST | `/evict` | controller/src/modules/engines/lifecycle-routes.ts:55 | app.ts → registerEngineRoutes → registerLifecycleRoutes | static-wired |  |
| GET | `/gpus` | controller/src/modules/system/routes.ts:104 | app.ts → registerSystemRoutes | static-wired |  |
| GET | `/health` | controller/src/http/app.ts:101 | app.ts (direct assembly) | static-wired |  |
| POST | `/launch/:recipeId` | controller/src/modules/engines/lifecycle-routes.ts:12 | app.ts → registerEngineRoutes → registerLifecycleRoutes | static-wired |  |
| POST | `/launch/:recipeId/cancel` | controller/src/modules/engines/lifecycle-routes.ts:40 | app.ts → registerEngineRoutes → registerLifecycleRoutes | static-wired |  |
| GET | `/logs` | controller/src/modules/system/logs-routes.ts:202 | app.ts → registerSystemRoutes → registerLogsRoutes | static-wired |  |
| GET | `/logs/:sessionId` | controller/src/modules/system/logs-routes.ts:259 | app.ts → registerSystemRoutes → registerLogsRoutes | static-wired |  |
| DELETE | `/logs/:sessionId` | controller/src/modules/system/logs-routes.ts:298 | app.ts → registerSystemRoutes → registerLogsRoutes | static-wired |  |
| GET | `/logs/:sessionId/stream` | controller/src/modules/system/logs-routes.ts:338 | app.ts → registerSystemRoutes → registerLogsRoutes | static-wired |  |
| GET | `/peak-metrics` | controller/src/modules/system/metrics-routes.ts:194 | app.ts → registerSystemRoutes → registerMonitoringRoutes | static-wired |  |
| GET | `/recipes` | controller/src/modules/engines/recipe-routes.ts:19 | app.ts → registerEngineRoutes → registerRecipeRoutes | static-wired |  |
| POST | `/recipes` | controller/src/modules/engines/recipe-routes.ts:53 | app.ts → registerEngineRoutes → registerRecipeRoutes | static-wired |  |
| GET | `/recipes/:recipeId` | controller/src/modules/engines/recipe-routes.ts:39 | app.ts → registerEngineRoutes → registerRecipeRoutes | static-wired |  |
| PUT | `/recipes/:recipeId` | controller/src/modules/engines/recipe-routes.ts:73 | app.ts → registerEngineRoutes → registerRecipeRoutes | static-wired |  |
| DELETE | `/recipes/:recipeId` | controller/src/modules/engines/recipe-routes.ts:94 | app.ts → registerEngineRoutes → registerRecipeRoutes | static-wired |  |
| POST | `/runtime/:backend/upgrade` | controller/src/modules/engines/runtime-routes.ts:217 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/cuda` | controller/src/modules/engines/runtime-routes.ts:203 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/jobs` | controller/src/modules/engines/runtime-routes.ts:113 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| POST | `/runtime/jobs` | controller/src/modules/engines/runtime-routes.ts:92 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/jobs/:jobId` | controller/src/modules/engines/runtime-routes.ts:119 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| POST | `/runtime/jobs/:jobId/cancel` | controller/src/modules/engines/runtime-routes.ts:130 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/llamacpp` | controller/src/modules/engines/runtime-routes.ts:179 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/llamacpp/config` | controller/src/modules/engines/runtime-routes.ts:156 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/mlx` | controller/src/modules/engines/runtime-routes.ts:191 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/rocm` | controller/src/modules/engines/runtime-routes.ts:209 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/sglang` | controller/src/modules/engines/runtime-routes.ts:167 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/targets` | controller/src/modules/engines/runtime-routes.ts:62 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| POST | `/runtime/targets/:targetId/select` | controller/src/modules/engines/runtime-routes.ts:74 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/vllm` | controller/src/modules/engines/runtime-routes.ts:144 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/runtime/vllm/config` | controller/src/modules/engines/runtime-routes.ts:150 | app.ts → registerEngineRoutes → registerRuntimeRoutes | static-wired |  |
| GET | `/status` | controller/src/modules/system/routes.ts:87 | app.ts → registerSystemRoutes | static-wired |  |
| GET | `/studio/diagnostics` | controller/src/modules/studio/routes.ts:167 | app.ts → registerStudioRoutes | static-wired |  |
| GET | `/studio/downloads` | controller/src/modules/engines/download-routes.ts:23 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| POST | `/studio/downloads` | controller/src/modules/engines/download-routes.ts:47 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| GET | `/studio/downloads/:downloadId` | controller/src/modules/engines/download-routes.ts:31 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| POST | `/studio/downloads/:downloadId/cancel` | controller/src/modules/engines/download-routes.ts:87 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| POST | `/studio/downloads/:downloadId/pause` | controller/src/modules/engines/download-routes.ts:62 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| POST | `/studio/downloads/:downloadId/resume` | controller/src/modules/engines/download-routes.ts:72 | app.ts → registerEngineRoutes → registerDownloadRoutes | static-wired |  |
| GET | `/studio/model-index` | controller/src/modules/studio/model-index.ts:80 | app.ts → registerStudioRoutes → registerStudioModelIndexRoutes | static-wired |  |
| POST | `/studio/models/delete` | controller/src/modules/studio/routes.ts:261 | app.ts → registerStudioRoutes | static-wired |  |
| POST | `/studio/models/move` | controller/src/modules/studio/routes.ts:285 | app.ts → registerStudioRoutes | static-wired |  |
| GET | `/studio/presets` | controller/src/modules/studio/routes.ts:238 | app.ts → registerStudioRoutes | static-wired |  |
| GET | `/studio/provider-models` | controller/src/modules/studio/provider-routes.ts:180 | app.ts → registerStudioRoutes → registerStudioProviderRoutes | static-wired |  |
| POST | `/studio/providers` | controller/src/modules/studio/provider-routes.ts:105 | app.ts → registerStudioRoutes → registerStudioProviderRoutes | static-wired |  |
| GET | `/studio/providers` | controller/src/modules/studio/provider-routes.ts:97 | app.ts → registerStudioRoutes → registerStudioProviderRoutes | static-wired |  |
| PUT | `/studio/providers/:id` | controller/src/modules/studio/provider-routes.ts:130 | app.ts → registerStudioRoutes → registerStudioProviderRoutes | static-wired |  |
| DELETE | `/studio/providers/:id` | controller/src/modules/studio/provider-routes.ts:162 | app.ts → registerStudioRoutes → registerStudioProviderRoutes | static-wired |  |
| GET | `/studio/rigs` | controller/src/modules/studio/rig-routes.ts:122 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| POST | `/studio/rigs` | controller/src/modules/studio/rig-routes.ts:135 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| PUT | `/studio/rigs/:rigId` | controller/src/modules/studio/rig-routes.ts:157 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| DELETE | `/studio/rigs/:rigId` | controller/src/modules/studio/rig-routes.ts:175 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| POST | `/studio/rigs/:rigId/nodes` | controller/src/modules/studio/rig-routes.ts:190 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| PUT | `/studio/rigs/:rigId/nodes/:nodeId` | controller/src/modules/studio/rig-routes.ts:219 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| DELETE | `/studio/rigs/:rigId/nodes/:nodeId` | controller/src/modules/studio/rig-routes.ts:252 | app.ts → registerStudioRoutes → registerStudioRigRoutes | static-wired |  |
| GET | `/studio/settings` | controller/src/modules/studio/routes.ts:126 | app.ts → registerStudioRoutes | static-wired |  |
| POST | `/studio/settings` | controller/src/modules/studio/routes.ts:132 | app.ts → registerStudioRoutes | static-wired |  |
| GET | `/studio/storage` | controller/src/modules/studio/routes.ts:213 | app.ts → registerStudioRoutes | static-wired |  |
| GET | `/usage` | controller/src/modules/system/usage-routes.ts:26 | app.ts → registerSystemRoutes → registerUsageRoutes | static-wired |  |
| POST | `/v1/audio/install` | controller/src/modules/speech/routes.ts:179 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/audio/install/cancel` | controller/src/modules/speech/routes.ts:195 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/audio/runtime/stop` | controller/src/modules/speech/routes.ts:245 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/audio/speech` | controller/src/modules/audio/routes.ts:204 | app.ts → registerAudioRoutes | static-wired |  |
| GET | `/v1/audio/status` | controller/src/modules/speech/routes.ts:169 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/audio/transcriptions` | controller/src/modules/audio/routes.ts:108 | app.ts → registerAudioRoutes | static-wired |  |
| GET | `/v1/audio/voices` | controller/src/modules/speech/routes.ts:208 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/audio/voices` | controller/src/modules/speech/routes.ts:220 | app.ts → registerSpeechRoutes | static-wired |  |
| DELETE | `/v1/audio/voices/:voiceId` | controller/src/modules/speech/routes.ts:225 | app.ts → registerSpeechRoutes | static-wired |  |
| POST | `/v1/chat/completions` | controller/src/modules/proxy/openai-routes.ts:250 | app.ts → registerAllProxyRoutes → registerOpenAIRoutes | static-wired |  |
| POST | `/v1/count-tokens` | controller/src/modules/proxy/tokenization-routes.ts:67 | app.ts → registerAllProxyRoutes → registerTokenizationRoutes | static-wired |  |
| GET | `/v1/huggingface/models` | controller/src/modules/models/routes.ts:296 | app.ts → registerModelsRoutes | static-wired |  |
| GET | `/v1/metrics/vllm` | controller/src/modules/system/metrics-routes.ts:176 | app.ts → registerSystemRoutes → registerMonitoringRoutes | static-wired |  |
| GET | `/v1/models` | controller/src/modules/models/routes.ts:70 | app.ts → registerModelsRoutes | static-wired |  |
| GET | `/v1/models/:modelId` | controller/src/modules/models/routes.ts:138 | app.ts → registerModelsRoutes | static-wired |  |
| GET | `/v1/studio/models` | controller/src/modules/models/routes.ts:188 | app.ts → registerModelsRoutes | static-wired |  |
| POST | `/v1/tokenize-chat-completions` | controller/src/modules/proxy/tokenization-routes.ts:86 | app.ts → registerAllProxyRoutes → registerTokenizationRoutes | static-wired |  |
| POST | `/vram-calculator` | controller/src/modules/system/routes.ts:137 | app.ts → registerSystemRoutes | static-wired |  |
| GET | `/wait-ready` | controller/src/modules/engines/lifecycle-routes.ts:70 | app.ts → registerEngineRoutes → registerLifecycleRoutes | static-wired |  |
