"use client";

import { Schema } from "effect";
import type { AccessFabricState } from "@local-studio/agent-runtime/access-fabric-contract";
import type { OnboardingState } from "@local-studio/agent-runtime/agent-onboarding-contract";
import type { KubernetesConnectionState } from "@local-studio/contracts/environment-commissioning";
import type { EnterpriseSessionView } from "@/features/settings/enterprise-access-section";
import type { FoundryHealth } from "@local-studio/contracts/foundry";
import type { WorkloadIdentityEvidence } from "@local-studio/contracts/workload-identity";
import type { SetupCommissioningProfile } from "@local-studio/contracts/setup-commissioning";

export const CommissioningClaimSchema = Schema.Literals([
  "observed",
  "claimed",
  "attested",
  "contradicted",
]);
export type CommissioningClaim = typeof CommissioningClaimSchema.Type;

export const ControllerCredentialCommissioningSchema = Schema.Struct({
  hasApiKey: Schema.Boolean,
  credentialStorage: Schema.Struct({
    kind: Schema.Literals([
      "native-keyring",
      "deployment-encrypted",
      "local-encrypted",
      "unavailable",
    ]),
    durable: Schema.Boolean,
    detail: Schema.String,
  }),
});
export type ControllerCredentialCommissioning = typeof ControllerCredentialCommissioningSchema.Type;

export interface CommissioningEvidence {
  id:
    | "access"
    | "controller-credential"
    | "credentials"
    | "foundry"
    | "kubernetes"
    | "workload-identity"
    | "private-access"
    | "inference"
    | "oidc-configuration"
    | "tensorprime"
    | "service-mtls";
  label: string;
  state: CommissioningClaim;
  detail: string;
  digest?: string;
  required: boolean;
}

export interface CommissioningReadiness {
  evidence: readonly CommissioningEvidence[];
  requiredReady: boolean;
  checkedAt: string;
}

export interface CommissioningSources {
  session: EnterpriseSessionView;
  controllerCredential: ControllerCredentialCommissioning;
  onboarding: OnboardingState;
  foundry: FoundryHealth;
  kubernetes: KubernetesConnectionState;
  workloadIdentity: WorkloadIdentityEvidence;
  accessFabric: AccessFabricState;
  setupProfile?: SetupCommissioningProfile;
}

const readyClaim = (state: CommissioningClaim) => state === "observed" || state === "attested";

export const canCompleteCommissioning = (
  readiness: CommissioningReadiness | null,
  inferenceObserved: boolean,
) => Boolean(readiness?.requiredReady && inferenceObserved);

export function deriveCommissioningReadiness(
  sources: CommissioningSources,
  checkedAt = new Date().toISOString(),
): CommissioningReadiness {
  const access = accessEvidence(sources.session);
  const controllerCredential = controllerCredentialEvidence(sources.controllerCredential);
  const credentials = credentialsEvidence(sources.onboarding);
  const foundry = foundryEvidence(sources.foundry);
  const kubernetes = kubernetesEvidence(sources.kubernetes);
  const workloadIdentity = workloadIdentityEvidence(sources.workloadIdentity);
  const privateAccess = privateAccessEvidence(sources.accessFabric);
  const oidcConfiguration = oidcConfigurationEvidence(sources.setupProfile);
  const tensorprime = tensorprimeEvidence(sources.setupProfile);
  const serviceMtls = serviceMtlsEvidence(sources.setupProfile);
  const evidence = [
    access,
    controllerCredential,
    credentials,
    foundry,
    kubernetes,
    workloadIdentity,
    privateAccess,
    oidcConfiguration,
    tensorprime,
    serviceMtls,
  ] as const;
  const requirements = sources.setupProfile?.requirements;
  controllerCredential.required ||= Boolean(requirements?.controller_credential);
  credentials.required ||= Boolean(requirements?.agents);
  kubernetes.required ||= Boolean(requirements?.kubernetes);
  workloadIdentity.required ||= Boolean(requirements?.workload_svid);
  return {
    evidence,
    requiredReady: evidence.every((entry) => !entry.required || readyClaim(entry.state)),
    checkedAt,
  };
}

function oidcConfigurationEvidence(
  profile: SetupCommissioningProfile | undefined,
): CommissioningEvidence {
  if (!profile?.oidc.enabled) {
    return {
      id: "oidc-configuration",
      label: "OIDC issuer metadata",
      state: "claimed",
      detail: "No deployment issuer is staged through commissioning.",
      required: Boolean(profile?.requirements.oidc),
    };
  }
  return {
    id: "oidc-configuration",
    label: "OIDC issuer metadata",
    state: profile.oidc.probe.state,
    detail: profile.oidc.probe.detail,
    required: profile.requirements.oidc,
  };
}

function tensorprimeEvidence(
  profile: SetupCommissioningProfile | undefined,
): CommissioningEvidence {
  const enabled = profile?.tensorprime_probes.filter((service) => service.enabled) ?? [];
  const contradicted = enabled.find((service) => service.probe.state === "contradicted");
  const observed =
    enabled.length > 0 && enabled.every((service) => service.probe.state === "observed");
  return {
    id: "tensorprime",
    label: "TensorPrime service routes",
    state: contradicted ? "contradicted" : observed ? "observed" : "claimed",
    detail: contradicted
      ? `${contradicted.label}: ${contradicted.probe.detail}`
      : observed
        ? `${enabled.length} enabled service routes responded to server-side probes.`
        : "Configured service routes have not all been observed.",
    required: Boolean(profile?.requirements.tensorprime),
  };
}

function serviceMtlsEvidence(
  profile: SetupCommissioningProfile | undefined,
): CommissioningEvidence {
  const phase = profile?.spiffe;
  return {
    id: "service-mtls",
    label: "Service mTLS enforcement",
    state:
      phase?.service_mtls === "observed"
        ? "observed"
        : phase?.service_mtls === "contradicted"
          ? "contradicted"
          : "claimed",
    detail:
      phase?.service_mtls === "not_enforced"
        ? "Phase 0 does not enforce or validate service mTLS."
        : (phase?.detail ?? "Service mTLS has not been commissioned."),
    required: false,
  };
}

function controllerCredentialEvidence(
  credential: ControllerCredentialCommissioning,
): CommissioningEvidence {
  const observed = credential.hasApiKey && credential.credentialStorage.durable;
  const contradicted = credential.hasApiKey && !credential.credentialStorage.durable;
  return {
    id: "controller-credential",
    label: "Controller credential storage",
    state: observed ? "observed" : contradicted ? "contradicted" : "claimed",
    detail: credential.hasApiKey
      ? credential.credentialStorage.detail
      : `No controller credential is configured. ${credential.credentialStorage.detail}`,
    required: contradicted,
  };
}

function workloadIdentityEvidence(evidence: WorkloadIdentityEvidence): CommissioningEvidence {
  return {
    id: "workload-identity",
    label: "SPIFFE workload identity",
    state: evidence.state === "unconfigured" ? "claimed" : evidence.state,
    detail: evidence.detail,
    required: evidence.required,
  };
}

function foundryEvidence(health: FoundryHealth): CommissioningEvidence {
  return {
    id: "foundry",
    label: "APIM and Microsoft Foundry",
    state: health.state,
    detail:
      health.state === "observed"
        ? `${health.model_count} admitted models and ${health.agent_count} admitted agents observed through APIM.`
        : health.detail,
    required: health.required,
  };
}

export function unavailableFoundryHealth(
  session: EnterpriseSessionView,
  cause: unknown,
): FoundryHealth {
  return {
    configured: session.authenticated,
    required: session.authenticated,
    state: session.authenticated ? "contradicted" : "claimed",
    detail: cause instanceof Error ? cause.message : "APIM and Foundry probe failed",
    correlation_ids: [],
    model_count: 0,
    agent_count: 0,
  };
}

function accessEvidence(session: EnterpriseSessionView): CommissioningEvidence {
  if (session.authenticated && session.principal) {
    return {
      id: "access",
      label: "Enterprise access",
      state: "observed",
      detail: `${session.principal.issuer_id} · ${session.principal.clearance} · token validated`,
      required: true,
    };
  }
  if (session.mode === "required_oidc") {
    return {
      id: "access",
      label: "Enterprise access",
      state: "contradicted",
      detail: "OIDC is required and no validated operator session is active.",
      required: true,
    };
  }
  return {
    id: "access",
    label: "Enterprise access",
    state: session.mode === "local" ? "observed" : "claimed",
    detail:
      session.mode === "local"
        ? "Local identity mode is active."
        : `${session.issuers.length} OIDC issuer${session.issuers.length === 1 ? "" : "s"} configured; sign-in is optional.`,
    required: false,
  };
}

function credentialsEvidence(onboarding: OnboardingState): CommissioningEvidence {
  if (onboarding.recovery) {
    return {
      id: "credentials",
      label: "Credentials and agents",
      state: "contradicted",
      detail: `${onboarding.recovery.operation} recovery requires operator action.`,
      digest: onboarding.recovery.profileDigest,
      required: true,
    };
  }
  if (onboarding.receipt) {
    return {
      id: "credentials",
      label: "Credentials and agents",
      state: "observed",
      detail: `${onboarding.receipt.probes.filter((probe) => probe.ok).length} verified target observations and a receipt digest were recorded.`,
      digest: onboarding.receipt.profileDigest,
      required: false,
    };
  }
  return {
    id: "credentials",
    label: "Credentials and agents",
    state: onboarding.keyring.available ? "claimed" : "contradicted",
    detail: onboarding.keyring.available
      ? `${onboarding.keyring.credentialRefs.length} keyring credential reference${onboarding.keyring.credentialRefs.length === 1 ? "" : "s"} present; enrollment not applied.`
      : "Native keyring is unavailable in this deployment.",
    required: false,
  };
}

function kubernetesEvidence(state: KubernetesConnectionState): CommissioningEvidence {
  if (!state.configuration.enabled) {
    return {
      id: "kubernetes",
      label: "Kubernetes and KubeRay",
      state: "claimed",
      detail: "Workload admission is not enabled.",
      required: false,
    };
  }
  return {
    id: "kubernetes",
    label: "Kubernetes and KubeRay",
    state: state.probe.state === "unconfigured" ? "claimed" : state.probe.state,
    detail:
      state.probe.state === "observed"
        ? `${state.probe.kubernetes_version ?? "Kubernetes observed"} · ${state.probe.ray_api_version ?? "Ray API observed"}`
        : state.probe.detail,
    required: true,
  };
}

function privateAccessEvidence(state: AccessFabricState): CommissioningEvidence {
  const enabled = state.profile.netbird.enabled || state.profile.boundary.enabled;
  if (state.recovery) {
    return {
      id: "private-access",
      label: "Private access fabric",
      state: "contradicted",
      detail: `${state.recovery.operation} recovery requires operator action.`,
      required: true,
    };
  }
  if (state.receipt) {
    return {
      id: "private-access",
      label: "Private access fabric",
      state: "observed",
      detail: `${state.receipt.resources.length} managed resource${state.receipt.resources.length === 1 ? "" : "s"} and a receipt digest were recorded.`,
      digest: state.receipt.profileDigest,
      required: enabled,
    };
  }
  return {
    id: "private-access",
    label: "Private access fabric",
    state: "claimed",
    detail: enabled
      ? "Enrollment is enabled but has not been applied."
      : "Private access is not enabled.",
    required: enabled,
  };
}
