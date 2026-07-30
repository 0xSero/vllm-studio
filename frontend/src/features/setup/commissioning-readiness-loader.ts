"use client";

import { Effect, Schema } from "effect";
import { useCallback, useState } from "react";
import {
  AccessFabricStateSchema,
  type AccessFabricState,
} from "@local-studio/agent-runtime/access-fabric-contract";
import {
  OnboardingStateSchema,
  type OnboardingState,
} from "@local-studio/agent-runtime/agent-onboarding-contract";
import {
  KubernetesConnectionStateSchema,
  type KubernetesConnectionState,
} from "@local-studio/contracts/environment-commissioning";
import { FoundryHealthSchema } from "@local-studio/contracts/foundry";
import {
  WorkloadIdentityEvidenceSchema,
  type WorkloadIdentityEvidence,
} from "@local-studio/contracts/workload-identity";
import {
  SetupCommissioningProfileSchema,
  type SetupCommissioningProfile,
} from "@local-studio/contracts/setup-commissioning";
import {
  EnterpriseSessionViewSchema,
  type EnterpriseSessionView,
} from "@/features/settings/enterprise-access-section";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import {
  ControllerCredentialCommissioningSchema,
  deriveCommissioningReadiness,
  unavailableFoundryHealth,
  type CommissioningReadiness,
  type ControllerCredentialCommissioning,
} from "./commissioning-readiness";

const fetchUnknown = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { cache: "no-store" });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return payload;
};

const valueOr = <T>(
  result: PromiseSettledResult<unknown>,
  decode: (value: unknown) => T,
  fallback: T,
): T => {
  if (result.status !== "fulfilled") return fallback;
  try {
    return decode(result.value);
  } catch {
    return fallback;
  }
};

const UNAVAILABLE_SETUP_PROFILE: SetupCommissioningProfile = {
  version: 1,
  revision: 0,
  classification: "C2",
  updated_at: new Date(0).toISOString(),
  requirements: {
    controller_credential: false,
    oidc: false,
    kubernetes: false,
    tensorprime: true,
    agents: false,
    workload_svid: false,
  },
  oidc: {
    enabled: false,
    kind: "entra",
    issuer: "",
    client_id: "",
    audience: "",
    tenant_or_realm: "",
    probe: {
      state: "claimed",
      checked_at: null,
      status: null,
      detail: "OIDC commissioning metadata is unavailable.",
    },
  },
  tensorprime_probes: [
    {
      id: "api",
      label: "Inference API",
      kind: "unified-api",
      catalog_service_id: "llm-api-external",
      enabled: true,
      base_url: "http://127.0.0.1",
      host_header: "",
      probe_path: "/v1/models",
      probe: {
        state: "contradicted",
        checked_at: null,
        status: null,
        detail: "Commissioning profile evidence is unavailable.",
      },
    },
  ],
  spiffe: {
    trust_domain: "tprime.vlans.ca",
    identity_plane: "claimed",
    workload_svid: "claimed",
    service_mtls: "not_enforced",
    detail: "Phase 0 service mTLS is not enforced.",
  },
};

const loadSources = async () =>
  Promise.allSettled([
    fetchUnknown("/api/auth/session"),
    fetchUnknown("/api/settings"),
    fetchUnknown("/api/agent/onboarding"),
    fetchUnknown("/api/proxy/ai/v1/health"),
    api.getKubernetesConnection(),
    fetchUnknown("/api/agent/workload-identity"),
    fetchUnknown("/api/agent/access-fabric"),
    fetchUnknown("/api/setup/commissioning"),
  ]);

const sessionFrom = (result: PromiseSettledResult<unknown>): EnterpriseSessionView =>
  valueOr(result, Schema.decodeUnknownSync(EnterpriseSessionViewSchema), {
    mode: "required_oidc",
    issuers: [],
    authenticated: false,
    principal: null,
    expires_at: null,
  });

const controllerFrom = (result: PromiseSettledResult<unknown>): ControllerCredentialCommissioning =>
  valueOr(result, Schema.decodeUnknownSync(ControllerCredentialCommissioningSchema), {
    hasApiKey: true,
    credentialStorage: {
      kind: "unavailable",
      durable: false,
      detail: "Controller credential state is unavailable.",
    },
  });

const onboardingFrom = (result: PromiseSettledResult<unknown>): OnboardingState =>
  valueOr(result, Schema.decodeUnknownSync(OnboardingStateSchema), {
    profile: {},
    keyring: { available: false, credentialRefs: [] },
    probes: [],
    receipt: null,
    recovery: null,
  } as unknown as OnboardingState);

const foundryFrom = (result: PromiseSettledResult<unknown>, session: EnterpriseSessionView) =>
  result.status === "fulfilled"
    ? valueOr(
        result,
        Schema.decodeUnknownSync(FoundryHealthSchema),
        unavailableFoundryHealth(session, new Error("APIM and Foundry evidence is invalid")),
      )
    : unavailableFoundryHealth(
        session,
        result.reason ?? new Error("APIM and Foundry probe failed"),
      );

const kubernetesFrom = (result: PromiseSettledResult<unknown>): KubernetesConnectionState =>
  valueOr(result, Schema.decodeUnknownSync(KubernetesConnectionStateSchema), {
    configuration: { enabled: true, api_url: "", token_file: "", ca_file: null },
    probe: {
      state: "contradicted",
      checked_at: null,
      kubernetes_version: null,
      ray_api_version: null,
      detail: "Kubernetes commissioning evidence is unavailable.",
    },
  });

const workloadFrom = (result: PromiseSettledResult<unknown>): WorkloadIdentityEvidence =>
  valueOr(result, Schema.decodeUnknownSync(WorkloadIdentityEvidenceSchema), {
    configured: true,
    required: true,
    state: "contradicted",
    spiffe_id: null,
    trust_domain: null,
    audience: null,
    expires_at: null,
    checked_at: null,
    jwt_svid_validated: false,
    x509_mtls: "not_verified",
    detail: "Workload identity evidence is unavailable.",
  });

const accessFrom = (result: PromiseSettledResult<unknown>): AccessFabricState =>
  valueOr(result, Schema.decodeUnknownSync(AccessFabricStateSchema), {
    profile: { netbird: { enabled: false }, boundary: { enabled: false } },
    probes: [],
    plan: null,
    receipt: null,
    recovery: {
      operation: "apply",
      failedAt: new Date(0).toISOString(),
      failures: ["Private access evidence is unavailable."],
    },
  } as unknown as AccessFabricState);

const profileFrom = (result: PromiseSettledResult<unknown>): SetupCommissioningProfile =>
  valueOr(
    result,
    Schema.decodeUnknownSync(SetupCommissioningProfileSchema),
    UNAVAILABLE_SETUP_PROFILE,
  );

const readinessFrom = (results: PromiseSettledResult<unknown>[]): CommissioningReadiness => {
  const session = sessionFrom(results[0]!);
  return deriveCommissioningReadiness({
    session,
    controllerCredential: controllerFrom(results[1]!),
    onboarding: onboardingFrom(results[2]!),
    foundry: foundryFrom(results[3]!, session),
    kubernetes: kubernetesFrom(results[4]!),
    workloadIdentity: workloadFrom(results[5]!),
    accessFabric: accessFrom(results[6]!),
    setupProfile: profileFrom(results[7]!),
  });
};

const loadCommissioningReadiness = Effect.tryPromise({
  try: async () => readinessFrom(await loadSources()),
  catch: (cause) =>
    new Error(cause instanceof Error ? cause.message : "Commissioning readiness is unavailable"),
});

export function useCommissioningReadiness() {
  const [readiness, setReadiness] = useState<CommissioningReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReadiness(await Effect.runPromise(loadCommissioningReadiness));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commissioning readiness is unavailable");
    } finally {
      setLoading(false);
    }
  }, []);
  useMountSubscription(() => {
    void refresh();
  }, [refresh]);
  return { readiness, loading, error, refresh };
}
