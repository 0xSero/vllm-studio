# ADR-002: SPIFFE workload identity boundary

## Status

Accepted for the JWT-SVID and X.509-SVID service-authentication slice. Live cluster acceptance is pending.

## Context

OIDC identifies a human operator and carries authorization roles, entitlements, tenant, and C2 clearance. It does not establish the identity of the frontend, controller, or agent-runtime processes. Static service tokens also do not provide attestation or automatic rotation.

## Decision

Shared deployments require independently validated JWT-SVID and X.509-SVID identities on service-to-service HTTP requests. Each workload streams rotating X.509-SVID material from its node-local Workload API and obtains a short-lived audience-bound JWT-SVID for each outbound hop. The receiving service validates both identities independently, admits exact configured SPIFFE IDs, and requires the JWT subject to match the TLS peer.

Human OIDC and workload SPIFFE validation are sequential gates. SPIFFE identity never creates a user principal, role, entitlement, tenant, or clearance.

The implementation uses direct gRPC Workload API calls over a Unix socket and sends the mandatory `workload.spiffe.io: true` metadata. SVIDs are not persisted, returned to browser components, logged, or passed in process arguments.

SPIRE registration selects exact namespace, ServiceAccount, and component labels. The catch-all chart identity is disabled. Delegated Identity API, Broker API, and federation are not enabled.

## Consequences

Required mode fails closed when the workload socket, issuance, validation, audience, trust domain, or admitted peer is invalid. Optional mode preserves local recovery without representing the connection as observed.

JWT-SVID validation and X.509-SVID peer authorization produce separate per-hop evidence. Rotation replaces the complete in-memory certificate, key, and bundle snapshot and clears superseded private-key buffers. Hermetic protocol and TLS checks do not replace live SPIRE, CSI, NetworkPolicy, revocation, and multi-replica acceptance.
