# Task 07 — Adapt the T3 Usage experience to Local Studio

## Objective

Deliver a polished Local Studio Usage surface inspired by the pinned T3 nightly while using Local Studio contracts, components, tokens, copy, and truthful data states.

## Dependencies

- Task 06 contract/collectors/merge semantics passing.
- Task 10 design contract may refine native semantics, but this task uses the current shared Local Studio UI kit.

## Files involved

- `frontend/src/features/usage/usage-page.tsx`
- `frontend/src/features/usage/use-usage.ts`
- Usage charts, filters, source-coverage components, and tests
- `frontend/src/lib/page-data-cache.ts`
- `frontend/src/app/styles/globals/mobile.css` and targeted token/component styles
- Pinned upstream source/provenance record

## Work

1. Render separate **AI session activity** and **controller serving** sections with plain-language explanations of their overlap and semantics. When models serve concurrently, controller-serving views break down by serving instance/served model from the [Task 12](task-12.md) contract rather than one merged series.
2. Add 7/30/90-day range, cost/tokens mode, provider/runtime/environment/project/model breakdowns, daily trend, cache savings, and source coverage where the contract supports them.
3. Show loading only until all queried environments reach terminal status, then present complete/partial/failed/duplicate/unpriced coverage without totals jumping silently.
4. Show ChatGPT as a distinct imported source when an authorized export/API is configured, or as an explicit unsupported/pending coverage item; do not imply it is scanned automatically.
5. Key cached page data by controller/environment identity and schema version; define refresh/staleness behavior rather than using one process-global key forever.
6. Use Local Studio cards, typography, controls, colors, radii, spacing, focus states, and empty/error language. Do not transplant upstream CSS/layout wholesale.
7. Correct mobile selectors so tiny heatmap cells do not inherit global 44 px button geometry. Keep accessible labels/targets without creating a 371-button overflow wall.
8. Keep charts bounded for large model/source sets and preserve keyboard, screen-reader, reduced-motion, high-contrast, and responsive behavior.
9. Add source/provenance details without exposing private paths or implying estimated cost equals money paid.

## Tests

- Success, empty, partial, failed, stale-contract, duplicate, unpriced, remote-late, and mixed controller/session fixtures.
- Filter/range/toggle semantics and cache identity/invalidation.
- Responsive 390×844, 768×1024, desktop, orientation, safe-area, font scaling, keyboard and reduced-motion checks.
- No layout overflow except explicit local scrollers; no color-only status.

## Validation

- Worker runs component/unit checks browserlessly.
- Codex performs one serialized visual pass through the sole browser profile and captures approved breakpoints.
- Run `npm run check`.
- Rebuild/install Local Studio Dev and verify the real controller plus multi-environment fixture separately.

## Acceptance criteria

- Fixture totals and statuses match Task 06 exactly.
- The page is recognizably Local Studio and meets the pinned interaction intent without unsupported metrics.
- ChatGPT import coverage is visibly proven or pending; it cannot be silently counted as complete.
- Desktop and mobile layouts pass responsive/accessibility gates with no heatmap overflow regression.
- Controller telemetry cannot be mistaken for all AI-session activity, and concurrent serving instances stay visually distinct, including vision-sidecar attribution from [Task 14](task-14.md).
- Screenshots and installed-Electron proof are manifest-listed under the exact build.

## Rollback

Keep contract/collector work independent from presentation. A UI rollback may restore the old view through a short-lived adapter without losing accurate new aggregates.
