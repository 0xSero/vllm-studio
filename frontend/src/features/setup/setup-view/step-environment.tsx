"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  KubernetesConnectionStateSchema,
  type KubernetesConnectionConfig,
  type KubernetesConnectionState,
} from "@local-studio/contracts/environment-commissioning";
import { Alert, Button, CheckboxRow, FormField, FormSection, Input, Spinner } from "@/ui";
import { Network, Server, ShieldCheck } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { AccessFabricPanel } from "@/features/integrations/access-fabric-panel";
import {
  WorkloadIdentityEvidenceSchema,
  type WorkloadIdentityEvidence,
} from "@local-studio/contracts/workload-identity";
import { TensorPrimeCommissioning } from "./tensorprime-commissioning";

const decodeState = Schema.decodeUnknownSync(KubernetesConnectionStateSchema);

const emptyConfiguration: KubernetesConnectionConfig = {
  enabled: false,
  api_url: "",
  token_file: "",
  ca_file: null,
};

export function StepEnvironment() {
  const [state, setState] = useState<KubernetesConnectionState | null>(null);
  const [configuration, setConfiguration] =
    useState<KubernetesConnectionConfig>(emptyConfiguration);
  const [workloadIdentity, setWorkloadIdentity] = useState<WorkloadIdentityEvidence | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [next, identityResponse] = await Promise.all([
        api.getKubernetesConnection(),
        fetch("/api/agent/workload-identity", { cache: "no-store" }),
      ]);
      const identity: unknown = await identityResponse.json();
      setState(next);
      setConfiguration(next.configuration);
      setWorkloadIdentity(Schema.decodeUnknownSync(WorkloadIdentityEvidenceSchema)(identity));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kubernetes configuration failed to load");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy("save");
    setError("");
    try {
      const next = decodeState(await api.saveKubernetesConnection(configuration));
      setState(next);
      setConfiguration(next.configuration);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kubernetes configuration was not saved");
    } finally {
      setBusy("");
    }
  };

  const probe = async () => {
    setBusy("probe");
    setError("");
    try {
      const next = decodeState(await api.probeKubernetesConnection());
      setState(next);
      setConfiguration(next.configuration);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kubernetes probe failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-7">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <FormSection
        icon={<Server className="h-4 w-4" />}
        title="Kubernetes and KubeRay"
        className="rounded-none"
      >
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          Connect the controller to an internal cluster without sending workload credentials to the
          browser.
        </p>
        {!state ? (
          <div className="flex min-h-20 items-center gap-3 text-(--ui-muted)">
            <Spinner />
            <span>Inspecting controller configuration…</span>
          </div>
        ) : (
          <>
            <CheckboxRow
              checked={configuration.enabled}
              onChange={(enabled) => setConfiguration((current) => ({ ...current, enabled }))}
              label="Enable Kubernetes workload admission"
              description="Scientific RayJobs use this connection after a successful controller probe."
              className="rounded-none"
            />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Kubernetes API URL">
                <Input
                  className="min-h-11 rounded-none font-mono"
                  disabled={!configuration.enabled}
                  value={configuration.api_url}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      api_url: event.target.value,
                    }))
                  }
                  placeholder="https://kubernetes.internal:6443"
                />
              </FormField>
              <FormField label="Service-account token file">
                <Input
                  className="min-h-11 rounded-none font-mono"
                  disabled={!configuration.enabled}
                  value={configuration.token_file}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      token_file: event.target.value,
                    }))
                  }
                  placeholder="/var/run/secrets/.../token"
                />
              </FormField>
              <FormField
                label="Cluster CA file"
                description="Optional for a publicly trusted endpoint."
              >
                <Input
                  className="min-h-11 rounded-none font-mono"
                  disabled={!configuration.enabled}
                  value={configuration.ca_file ?? ""}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      ca_file: event.target.value || null,
                    }))
                  }
                  placeholder="/etc/kubernetes/pki/ca.crt"
                />
              </FormField>
              <div className="flex items-end gap-2">
                <Button
                  variant="secondary"
                  className="min-h-11"
                  disabled={Boolean(busy)}
                  onClick={() => void save()}
                >
                  {busy === "save" ? "Saving…" : "Save connection"}
                </Button>
                <Button
                  className="min-h-11"
                  disabled={Boolean(busy) || !configuration.enabled}
                  onClick={() => void probe()}
                >
                  {busy === "probe" ? "Probing…" : "Probe cluster"}
                </Button>
              </div>
            </div>
            <div
              aria-live="polite"
              className="grid gap-3 border border-(--ui-separator) bg-(--ui-bg) p-4 text-[length:var(--fs-sm)] sm:grid-cols-3"
            >
              <ConnectionFact label="Standing" value={state.probe.state} />
              <ConnectionFact
                label="Kubernetes"
                value={state.probe.kubernetes_version ?? "not observed"}
              />
              <ConnectionFact
                label="Ray API"
                value={state.probe.ray_api_version ?? "not observed"}
              />
              <p className="sm:col-span-3 text-(--ui-muted)">{state.probe.detail}</p>
            </div>
          </>
        )}
      </FormSection>

      <FormSection
        icon={<ShieldCheck className="h-4 w-4" />}
        title="SPIFFE workload identity"
        className="rounded-none"
      >
        {!workloadIdentity ? (
          <div className="flex min-h-20 items-center gap-3 text-(--ui-muted)">
            <Spinner />
            <span>Inspecting workload identity…</span>
          </div>
        ) : (
          <div
            aria-live="polite"
            className="grid gap-3 border border-(--ui-separator) bg-(--ui-bg) p-4 text-[length:var(--fs-sm)] sm:grid-cols-3"
          >
            <ConnectionFact label="Standing" value={workloadIdentity.state} />
            <ConnectionFact
              label="SPIFFE ID"
              value={workloadIdentity.spiffe_id ?? "not observed"}
            />
            <ConnectionFact
              label="Trust domain"
              value={workloadIdentity.trust_domain ?? "not configured"}
            />
            <ConnectionFact
              label="JWT-SVID"
              value={workloadIdentity.jwt_svid_validated ? "validated" : "not validated"}
            />
            <ConnectionFact label="X.509 mTLS" value={workloadIdentity.x509_mtls} />
            <ConnectionFact
              label="Audience"
              value={workloadIdentity.audience ?? "not configured"}
            />
            <p className="sm:col-span-3 text-(--ui-muted)">{workloadIdentity.detail}</p>
            <p className="sm:col-span-3 border-t border-(--ui-separator) pt-3 text-(--ui-muted)">
              Phase 0 separates SVID readiness from service transport enforcement. A workload SVID
              does not establish that TensorPrime services require or validate peer mTLS.
            </p>
            {workloadIdentity.hops?.map((hop) => (
              <div
                key={`${hop.source}:${hop.destination}`}
                className="sm:col-span-3 grid grid-cols-[1fr_auto] gap-3 border-t border-(--ui-separator) pt-3"
              >
                <span className="truncate font-mono">
                  {hop.source} → {hop.destination}
                </span>
                <span>
                  JWT {hop.jwt_svid ? "observed" : "not observed"} · mTLS{" "}
                  {hop.x509_mtls ? "observed" : "not observed"}
                </span>
              </div>
            ))}
          </div>
        )}
      </FormSection>

      <TensorPrimeCommissioning />

      <section aria-labelledby="access-fabric-title" className="space-y-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-(--ui-muted)" aria-hidden="true" />
          <h2 id="access-fabric-title" className="text-[length:var(--fs-lg)] font-medium">
            Private access fabric
          </h2>
        </div>
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          Commission NetBird and Boundary when the cluster or remote APIs are not directly routable.
        </p>
        <AccessFabricPanel />
      </section>

      <div className="flex items-start gap-3 border border-(--ui-separator) bg-(--ui-surface) p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          Only endpoint metadata and controller-local file references are persisted. Token contents
          are read by the controller at request time and are never returned to this surface.
        </p>
      </div>
    </div>
  );
}

function ConnectionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-[length:var(--fs-sm)] text-(--ui-fg)">
        {value}
      </div>
    </div>
  );
}
