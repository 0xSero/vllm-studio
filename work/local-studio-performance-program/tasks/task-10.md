# Task 10 — Converge Local Studio, Litter, and Alleycat product design

## Objective

Create a restrained shared product-design contract based on Local Studio's mobile semantics and apply it to touched Litter/Alleycat surfaces after identity and timeline structure are stable.

## Dependencies

- Tasks 03 and 04 structural performance work.
- Task 05 identity/pairing states.
- Task 09 goals/capabilities/controls.

## Files involved

- Local Studio UI-kit barrel and design tokens
- A small versioned semantic design contract and golden reference screens
- Litter's shared JSON theme assets and iOS/Android semantic adapters
- Pairing, session list, conversation, composer, goal, capability, error/offline, and Usage-related native surfaces
- Alleycat-facing labels/states presented through Litter; daemon code remains headless

## Work

1. Inventory existing Local Studio and Litter semantics before changing pixels: color roles, spacing, radii, type scale, density, focus/pressed/disabled/error/offline states, icon treatment, and navigation hierarchy.
2. Define a compact versioned product-design contract and golden screens. Reuse the existing cross-platform JSON theme pipeline where it fits.
3. Preserve native iOS and Android navigation, accessibility, safe areas, system typography behavior, and platform interaction patterns. Do not mirror Electron layout wholesale.
4. Reduce Litter visual noise and density using Local Studio mobile hierarchy while preserving information-rich reasoning/tool/session states.
5. Make pairing mode, execution target, runtime, goal, tool access, unavailable capability, reconnect, and archive states visually consistent and unambiguous.
6. Use shared semantic tokens/components for all newly touched Local Studio UI. Eliminate one-off colors/spacing only inside accepted surfaces.
7. Apply changes in small screen/component groups after performance work, because virtualization/chunking changes layout and scrolling.
8. Keep the daemon/transport free of presentation concerns; Alleycat's contribution is typed state/capability truth, not duplicated styling.

## Tests

- Golden reference comparisons for session inventory, active conversation, pairing, remote target picker, Usage, goals/tool access, offline/error, and empty states.
- iOS compact/regular widths, dynamic type, light/dark/high contrast, voice control/VoiceOver-relevant labels.
- Android phone/tablet, font scaling, light/dark, TalkBack-relevant labels, and edge-to-edge/safe-area behavior.
- Local Studio 390×844, 768×1024, and desktop responsive checks.
- No identity/capability state conveyed by color alone.

## Browser discipline

Design implementation and snapshot preparation are browserless. Codex alone performs the queued Local Studio visual pass in the single browser profile; native simulator/device capture is serialized afterward and does not open browsers.

## Validation

- Run repository design/component/unit gates and both Litter platform builds.
- Run `npm run check` for Local Studio changes.
- Review exact golden deltas, not broad subjective screenshots.
- Verify installed Electron and installed native surfaces separately.

## Acceptance criteria

- Touched Litter screens feel like the same product family as Local Studio mobile without losing native platform behavior.
- New UI uses semantic tokens and shared controls rather than one-off styling.
- Pairing/runtime/target/goal/capability states remain truthful and accessible.
- Performance budgets from Tasks 03 and 04 do not regress.
- Approved golden screens and installed captures are manifest-listed.

## Rollback

Keep the semantic contract, native adapters, and screen groups in separable commits. Revert a screen group without reverting identity, performance, or capability correctness.
