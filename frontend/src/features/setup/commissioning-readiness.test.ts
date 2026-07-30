import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canCompleteCommissioning,
  deriveCommissioningReadiness,
  type CommissioningSources,
  unavailableFoundryHealth,
} from "./commissioning-readiness";
import { decodeSetupTrack } from "./use-setup-track";

const sources = (overrides: Partial<CommissioningSources> = {}): CommissioningSources =>
  ({
    session: {
      mode: "local",
      issuers: [],
      authenticated: false,
      principal: null,
      expires_at: null,
    },
    controllerCredential: {
      hasApiKey: false,
      credentialStorage: {
        kind: "local-encrypted",
        durable: true,
        detail: "Controller credentials are encrypted for this local workstation.",
      },
    },
    onboarding: {
      profile: {},
      keyring: { available: true, credentialRefs: [] },
      probes: [],
      receipt: null,
      recovery: null,
    },
    foundry: {
      configured: false,
      required: false,
      state: "claimed",
      detail: "Microsoft Foundry is not configured.",
      correlation_ids: [],
      model_count: 0,
      agent_count: 0,
    },
    kubernetes: {
      configuration: { enabled: false, api_url: "", token_file: "", ca_file: null },
      probe: {
        state: "unconfigured",
        checked_at: null,
        kubernetes_version: null,
        ray_api_version: null,
        detail: "Not configured",
      },
    },
    workloadIdentity: {
      configured: false,
      required: false,
      state: "unconfigured",
      spiffe_id: null,
      trust_domain: null,
      audience: null,
      expires_at: null,
      checked_at: null,
      jwt_svid_validated: false,
      x509_mtls: "not_verified",
      detail: "SPIFFE workload identity is not configured.",
    },
    accessFabric: {
      profile: {
        netbird: { enabled: false },
        boundary: { enabled: false },
      },
      probes: [],
      plan: null,
      receipt: null,
      recovery: null,
    },
    ...overrides,
  }) as CommissioningSources;

describe("commissioning readiness", () => {
  test("treats inactive optional integrations as non-blocking claims", () => {
    const readiness = deriveCommissioningReadiness(sources(), "2026-07-29T12:00:00.000Z");
    assert.equal(readiness.requiredReady, true);
    assert.equal(canCompleteCommissioning(readiness, false), false);
    assert.equal(canCompleteCommissioning(readiness, true), true);
    assert.deepEqual(
      readiness.evidence.map(({ id, state, required }) => ({ id, state, required })),
      [
        { id: "access", state: "observed", required: false },
        { id: "controller-credential", state: "claimed", required: false },
        { id: "credentials", state: "claimed", required: false },
        { id: "foundry", state: "claimed", required: false },
        { id: "kubernetes", state: "claimed", required: false },
        { id: "workload-identity", state: "claimed", required: false },
        { id: "private-access", state: "claimed", required: false },
        { id: "oidc-configuration", state: "claimed", required: false },
        { id: "tensorprime", state: "claimed", required: false },
        { id: "service-mtls", state: "claimed", required: false },
      ],
    );
  });

  test("blocks required OIDC and enabled environment integrations without evidence", () => {
    const readiness = deriveCommissioningReadiness(
      sources({
        session: {
          mode: "required_oidc",
          issuers: [{ id: "entra", kind: "entra", tenant: "tenant" }],
          authenticated: false,
          principal: null,
          expires_at: null,
        },
        kubernetes: {
          configuration: {
            enabled: true,
            api_url: "https://cluster.internal:6443",
            token_file: "/run/secrets/kubernetes/token",
            ca_file: null,
          },
          probe: {
            state: "contradicted",
            checked_at: "2026-07-29T12:00:00.000Z",
            kubernetes_version: null,
            ray_api_version: null,
            detail: "Ray API unavailable",
          },
        },
        accessFabric: {
          profile: {
            netbird: { enabled: true },
            boundary: { enabled: false },
          },
          probes: [],
          plan: null,
          receipt: null,
          recovery: null,
        } as unknown as CommissioningSources["accessFabric"],
      }),
    );
    assert.equal(readiness.requiredReady, false);
    assert.equal(readiness.evidence.find((entry) => entry.id === "access")?.state, "contradicted");
    assert.equal(readiness.evidence.find((entry) => entry.id === "private-access")?.required, true);
  });

  test("does not upgrade unsigned receipt digests to attested evidence", () => {
    const baseline = sources();
    const readiness = deriveCommissioningReadiness(
      sources({
        onboarding: {
          ...baseline.onboarding,
          receipt: {
            profileDigest: "sha256:onboarding",
            probes: [{ ok: true }],
          },
        } as unknown as CommissioningSources["onboarding"],
        accessFabric: {
          ...baseline.accessFabric,
          profile: {
            ...baseline.accessFabric.profile,
            netbird: { ...baseline.accessFabric.profile.netbird, enabled: true },
          },
          receipt: {
            profileDigest: "sha256:access",
            resources: [{ id: "peer" }],
          },
        } as unknown as CommissioningSources["accessFabric"],
      }),
    );
    assert.equal(readiness.evidence.find((entry) => entry.id === "credentials")?.state, "observed");
    assert.equal(
      readiness.evidence.find((entry) => entry.id === "private-access")?.state,
      "observed",
    );
    assert.equal(readiness.requiredReady, true);
  });

  test("requires durable storage when a controller credential is configured", () => {
    const contradicted = deriveCommissioningReadiness(
      sources({
        controllerCredential: {
          hasApiKey: true,
          credentialStorage: {
            kind: "unavailable",
            durable: false,
            detail: "A deployment-owned controller credential key is required.",
          },
        },
      }),
    );
    assert.equal(contradicted.requiredReady, false);
    assert.equal(
      contradicted.evidence.find((entry) => entry.id === "controller-credential")?.state,
      "contradicted",
    );

    const observed = deriveCommissioningReadiness(
      sources({
        controllerCredential: {
          hasApiKey: true,
          credentialStorage: {
            kind: "native-keyring",
            durable: true,
            detail:
              "Controller credentials are protected by the operating system credential store.",
          },
        },
      }),
    );
    assert.equal(
      observed.evidence.find((entry) => entry.id === "controller-credential")?.state,
      "observed",
    );
  });

  test("requires an observed APIM and Foundry probe when configured", () => {
    const contradicted = deriveCommissioningReadiness(
      sources({
        foundry: {
          configured: true,
          required: true,
          state: "contradicted",
          detail: "APIM model catalog returned 503",
          correlation_ids: [],
          model_count: 0,
          agent_count: 0,
        },
      }),
    );
    assert.equal(contradicted.requiredReady, false);
    const observed = deriveCommissioningReadiness(
      sources({
        foundry: {
          configured: true,
          required: true,
          state: "observed",
          detail: "APIM model and agent catalogs were observed.",
          provider_id: "foundry",
          correlation_ids: ["model-correlation", "agent-correlation"],
          checked_at: "2026-07-29T12:00:00.000Z",
          model_count: 2,
          agent_count: 1,
        },
      }),
    );
    assert.equal(observed.requiredReady, true);
    assert.equal(observed.evidence.find((entry) => entry.id === "foundry")?.state, "observed");
  });

  test("does not invent Foundry configuration when a signed-out probe is unavailable", () => {
    const unauthenticated = unavailableFoundryHealth(
      sources().session,
      new Error("Enterprise sign-in required"),
    );
    assert.deepEqual(unauthenticated, {
      configured: false,
      required: false,
      state: "claimed",
      detail: "Enterprise sign-in required",
      correlation_ids: [],
      model_count: 0,
      agent_count: 0,
    });
    const authenticated = unavailableFoundryHealth(
      {
        ...sources().session,
        authenticated: true,
        principal: {
          subject: "scientist-1",
          issuer: "https://issuer.example",
          issuer_id: "entra",
          tenant: "tenant",
          display_name: "Scientist",
          roles: ["scientist"],
          entitlements: ["model:invoke", "agent:invoke"],
          clearance: "C2",
          issued_at: 1,
          expires_at: 2,
        },
        expires_at: "2026-07-29T18:00:00.000Z",
      },
      new Error("APIM returned 503"),
    );
    assert.equal(authenticated.configured, true);
    assert.equal(authenticated.required, true);
    assert.equal(authenticated.state, "contradicted");
  });

  test("preserves only known URL-addressable tracks", () => {
    assert.equal(decodeSetupTrack("environment"), "environment");
    assert.equal(decodeSetupTrack("unknown"), "access");
    assert.equal(decodeSetupTrack(null), "access");
  });
});
