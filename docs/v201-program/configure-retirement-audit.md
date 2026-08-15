# Configure retirement audit and workpack

Date: 2026-08-15

Status: **staged GO for implementation, not a one-shot GO**. This is a sealed read-only audit of immutable commit `370b7aa29175b904fb81537f98748de1c8b03858`. The canonical branch advanced after the audit. No source change, route change, database migration, installed-app validation, or deletion is claimed here.

## Decision

Retire Configure only after its surviving destinations exist as canonical routes. Models becomes the default destination, Integrations moves intact into Settings, and system/controller controls move to Settings. The bespoke Server/OpenAPI frontend is removed in favor of the canonical Logs page, Settings system section, controller Swagger UI, and controller OpenAPI JSON.

Do not combine UI retirement with rigs API removal. Removing the unused rigs UI is low risk; deleting its API/store stack changes a persisted-data and compatibility boundary and must be a later commit after the compatibility shims pass installed acceptance.

P0 data rule: never drop or rewrite the SQLite `rigs` table in this workpack. Existing and copied data directories must retain it byte-for-byte so rollback and an older client remain possible. Any future table migration requires a separate reviewed migration, disposable-copy proof, backup, and rollback plan.

## Compatibility route matrix

Redirects must avoid loops, replace history where appropriate, preserve only recognized state, and discard unknown Configure-only parameters.

| Legacy entry | Canonical destination | Required preservation |
|---|---|---|
| `/configure`, `/configure#overview`, or `section=overview` | `/models` | none |
| `section=models` or `#models` | `/models` | preserve `new=1`; preserve valid `tab` values: `picks`, `get`, `serves`, `downloads` |
| `section=integrations` or `#integrations` | `/settings?integration=<tab>#integrations` | preserve valid values: `plugins`, `connectors`, `models`, `skills`; otherwise use `plugins` |
| `/integrations` | `/settings?integration=<tab>#integrations` | same integration-tab rule |
| `section=server`, `#server`, or `/server` | `/settings#system` | provide canonical links to `/logs`, controller `/api/docs`, and controller `/api/spec` |
| `section=rig` or `#rig` | `/settings#system` | no rig editor; preserve the database boundary below |
| unknown Configure section/hash | `/models` | do not forward unknown state |

The high-value Models deep link is `/configure?new=1&tab=serves#models`: it must become `/models?new=1&tab=serves` and open the New Serve flow. Existing dashboard entry points, replacement navigation, command search, and Models tab changes must emit `/models` URLs directly rather than rely on the shim.

## Owned path sets

### Delete after canonical destinations exist

- `frontend/src/features/configure/configure-navigation.ts`
- `frontend/src/features/configure/configure-page.tsx`
- `frontend/src/features/configure/hardware-art.tsx`
- `frontend/src/features/configure/node-form-modal.tsx`
- `frontend/src/features/configure/rig-node-card.tsx`
- `frontend/src/features/configure/rigs-section.tsx`
- `frontend/src/features/configure/use-configure.ts`
- `frontend/src/app/configure/loading.tsx`
- `frontend/src/features/logs/server-view.tsx`
- `frontend/src/features/logs/openapi-panel.tsx`

Keep `frontend/src/app/configure/page.tsx` as the compatibility shim. Rewrite `frontend/src/app/integrations/page.tsx` and `frontend/src/app/server/page.tsx` as canonical redirects. Replace Configure targets in `frontend/src/features/shell/left-sidebar-nav.tsx`, `frontend/src/features/agent/ui/sessions-command.tsx`, `frontend/src/features/dashboard/use-dashboard-data.ts`, and `frontend/src/features/agent/ui/chat-pane.tsx`.

### Relocate intact

Keep the behavior in `frontend/src/features/integrations/integrations-page.tsx`, `integration-navigation.ts`, `plugins-section.tsx`, `model-providers-section.tsx`, `skills-section.tsx`, the Google-account integration files, and `frontend/src/features/settings/connectors-section.tsx`. Mount that content under Settings and update its URL writer to the canonical `integration=<tab>#integrations` contract. This is relocation, not a redesign or feature reduction.

Keep `/logs` and `frontend/src/features/logs/logs-view.tsx`. Replace the duplicate OpenAPI renderer with authenticated links to the selected controller's canonical `/api/docs` and `/api/spec`; never expose or embed its credential in visible text or a copied URL.

### Later rigs API deprecation

Only after the UI/redirect release is accepted, delete these whole files:

- `frontend/src/lib/api/rigs.ts`
- `controller/contracts/rigs.ts`
- `controller/src/modules/studio/rig-detection.ts`
- `controller/src/modules/studio/rig-routes.ts`
- `controller/src/stores/rig-store.ts`

Remove only their wiring from `frontend/src/lib/api/create-api-client.ts`, `frontend/src/lib/api/core.ts`, `frontend/src/lib/types.ts`, `controller/src/app-context.ts`, `controller/src/modules/studio/routes.ts`, and `controller/contracts/controller-events.ts` (`RIG_UPDATED`). Do not drop the SQLite table. Do not broaden this stage into model, runtime-target, platform-detection, Settings system, or realtime-controller cleanup.

## Size estimate

The frozen `cloc` 2.06 audit at `370b7aa29` estimates **2,292 gross production code lines removed** across the whole-file and scoped-wiring manifest. Compatibility shims, canonical navigation, integration mounting, and system/API links are expected to add 7–42 lines, for an estimated **net reduction of 2,250–2,285 code lines**.

This is a planning estimate, not the program LOC ledger. Recompute the repository's frozen production manifest at the exact implemented product commit before crediting any reduction.

## Commit and gate sequence

1. `refactor(settings): relocate configure destinations` — mount Integrations intact, add system/logs/API destinations, and change all first-party navigation. Run the normal static/build gate and manually exercise the canonical routes.
2. `refactor(frontend): retire configure surfaces` — install the compatibility shims and delete Configure plus the duplicate Server/OpenAPI UI. Re-run the full repository gate and installed route matrix.
3. `refactor(controller): deprecate rigs api` — only after the prior release is accepted, remove the unused frontend API and controller API/store wiring while preserving the table. Prove a copied data directory and rollback before acceptance.
4. `docs(v201): seal configure retirement evidence` — record exact commits, frozen LOC, transcripts, screenshots/recording, copied-database hashes, and remaining gaps.

All touched production source must be comment-free. Add, restore, modify, or run no automated test code. Do not bypass hooks. A passing `npm run check` is required at each accepted product tip, but it is not installed behavior proof.

## Installed manual acceptance

| Surface | Acceptance |
|---|---|
| Configure default and unknown links | Bare, overview, and unknown links land on Models once, without a loop or stale Configure flash. |
| Models compatibility | All four valid tabs survive; invalid tabs normalize; `new=1&tab=serves` opens exactly one New Serve editor; direct Models navigation emits canonical URLs. |
| Integrations | Direct `/integrations` plus all four legacy tabs land in Settings; Plugins, Connectors, provider Models, Skills, refresh, empty/error/loading states, back/forward, and reload remain usable. |
| System and rigs links | Legacy rig/server links land on Settings System; hardware, engines, services, storage, and controller state still load with online, offline, and unauthorized controllers. |
| Logs and API reference | `/logs` remains usable. Swagger `/api/docs` and JSON `/api/spec` open against the selected controller with correct authorization and without leaking credentials. |
| Navigation | Desktop sidebar, narrow/mobile navigation, command search, dashboard Models actions, and chat Plugins action contain no first-party Configure target. |
| Persisted rigs data | On a disposable copy of a real data directory, record the database hash and `rigs` row/blob inventory before and after upgrade; prove they are unchanged. Prove the previous accepted build can still read that copy. Never use the live database for destructive validation. |
| Installed desktop | Record cold launch, direct-link launch, reload, back/forward, narrow window, and restart on the exact signed build; capture source/build provenance and the final route for each legacy URL. |

Acceptance remains RED until the exact implementation commit passes the repository gate, this installed matrix, copied-data proof, independent review, push, and hosted CI. The immutable audit alone does not complete GOAL row 2.4.
