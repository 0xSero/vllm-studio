# Realtime mobile contract

Status: contract version 1, not yet exposed by the controller gateway.

The realtime contract extends `litter-bridge/v1`; it does not create another endpoint or authentication model. Local Studio owns provider credentials, capability discovery, session creation, and teardown. Alleycat forwards authenticated control messages. Litter keeps native WebRTC peer connections and platform audio processing. Media does not traverse Alleycat in version 1.

The TypeScript schema module that held the canonical Effect types (`shared/agent/litter-bridge.ts`) was removed with the litter-bridge gateway in #412; the contract is currently specified only by this document and the conformance fixture. `shared/agent/litter-bridge-realtime-v1.fixture.json` is the language-neutral conformance vector for TypeScript and Rust consumers.

## Version negotiation

`protocolVersion` remains `1`. Realtime evolves independently through `contractVersion` so older controller operations remain stable. A client begins with `realtime_capabilities_request` and sends every realtime contract version it can decode. Version 1 accepts only `[1]`. A controller that cannot select a version returns `unsupported_version` and does not create a session.

The gateway advertises `realtime.session` only after the broker implementation is installed and usable. Merely compiling the contract does not advertise availability.

## Capability discovery

Each returned capability binds a provider adapter and model to:

- input and output modalities;
- signaling transport;
- supported voices;
- update and reconnect support;
- session lifetime and signaling payload bounds;
- explicit availability or one typed unavailability reason.

`provider_native` means Local Studio negotiates a provider-native realtime session. `local_pipeline` means Local Studio owns an STT to LLM to TTS pipeline behind the same lifecycle. Clients must not infer support from model names or silently substitute one provider for another.

## Lifecycle

The version 1 happy path is:

1. `realtime_capabilities_request` selects the contract and capability.
2. `realtime_session_create_request` carries a client-generated session identifier and native WebRTC offer.
3. `realtime_session_created` returns the authoritative broker session and answer.
4. `realtime_signal_request` carries bounded ICE updates when required.
5. `realtime_session_update_request` changes only typed mutable configuration.
6. `realtime_session_status` reports ordered authoritative state.
7. `realtime_session_close_request` tears down provider and broker resources.

Create, signal, update, and close are mutations and require an idempotency key. Retrying the same authenticated request and body returns the stored result. Reusing an idempotency key with different bytes fails with `integrity_failed`. Closing an already-closed session returns the same terminal session rather than creating an error-only cleanup loop.

The broker binds `sessionId`, `clientSessionId`, `deviceId`, and `capabilityId`. A session may only be read or changed by the authenticated device grant that created it. Requests for another device, controller, or capability fail closed without confirming whether the target exists.

## Reconnect and expiry

The broker may return a short-lived opaque reconnect token. It is scoped to one controller, device, and session and expires no later than the session. The token never replaces signed device authentication. A reconnect returns the existing authoritative session or an explicit `closed`, `expired`, or `failed` state; it must never create another provider session implicitly.

Expired sessions reject mutations with `realtime_session_expired`. Invalid state transitions use `realtime_state_conflict`. Controller shutdown closes or expires all owned sessions within the broker's documented cleanup bound.

## Security and logging

Long-lived provider keys never cross the bridge. Contract schemas reject excess properties, including an accidental provider API key. WebRTC SDP, ICE credentials, reconnect tokens, signatures, and controller secrets are sensitive and must be redacted from logs and crash reports.

The broker records only safe correlation fields and timings: request ID, hashed session correlation, state transition, result code, broker latency, and media connection latency. Broker latency ends when the session answer is available. Media connection latency ends when native WebRTC reports a connected peer; the two values must not be combined.

Requests retain the existing Litter bridge controls:

- Ed25519 device signatures and body hashes;
- a maximum 60-second request lifetime;
- nonce replay detection;
- device capability authorization;
- bounded bodies, signals, outstanding operations, and replay storage;
- idempotent mutation storage.

## Errors

Realtime operations reuse the typed Litter bridge error envelope. The contract adds:

- `realtime_unavailable`: the selected capability cannot create a session;
- `realtime_session_expired`: the authoritative session lifetime ended;
- `realtime_state_conflict`: the operation is invalid for the authoritative state.

Authentication, authorization, version, replay, integrity, payload, rate, controller, and internal failures continue to use the existing error codes. Public messages must not contain provider response bodies or credentials.

## Implementation sequence

1. Land this schema, documentation, and conformance fixture.
2. Add a Local Studio broker with a fake-provider lifecycle test before advertising `realtime.session`.
3. Consume the exact fixture and version identifier in Alleycat and Litter.
4. Expose the broker through the packaged Local Studio runtime and prove the installed application contract.
5. Add the optional local STT to LLM to TTS adapter behind `local_pipeline`.

Until steps 2 and 4 land, the contract is intentionally inert and existing controller, session, and model-serving behavior is unchanged.
