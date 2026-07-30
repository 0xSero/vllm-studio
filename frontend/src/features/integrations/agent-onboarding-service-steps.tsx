"use client";

import type {
  OnboardingProfile,
  OnboardingState,
} from "@local-studio/agent-runtime/agent-onboarding-contract";
import { CheckboxRow, FormField, FormSection, Input } from "@/ui";
import { Brain, ExternalLink, Network, ScanSearch, ShieldCheck } from "@/ui/icon-registry";
import {
  CredentialField,
  FactGrid,
  OnboardingButton,
  ProbeControl,
  type ProbeTarget,
} from "./agent-onboarding-controls";

type Props = {
  state: OnboardingState;
  credentials: Record<string, string>;
  busy: string;
  updateProfile: (change: (profile: OnboardingProfile) => OnboardingProfile) => void;
  setCredential: (ref: string, value: string) => void;
  probe: (target: ProbeTarget) => Promise<void>;
};

const probeFor = (state: OnboardingState, target: string) =>
  state.probes.find((candidate) => candidate.target === target);

export function EnterpriseServicesStep(props: Props) {
  return (
    <FormSection
      icon={<Network className="h-4 w-4" />}
      title="Enterprise services"
      className="rounded-none"
    >
      {props.state.profile.services.map((service) => (
        <div
          key={service.id}
          className="grid gap-3 border-b border-(--ui-separator) py-3 last:border-0 lg:grid-cols-[220px_1fr_220px]"
        >
          <CheckboxRow
            checked={service.enabled}
            onChange={(enabled) =>
              props.updateProfile((profile) => ({
                ...profile,
                services: profile.services.map((candidate) =>
                  candidate.id === service.id ? { ...candidate, enabled } : candidate,
                ),
              }))
            }
            label={service.name}
            description={service.credentialRef}
            className="border-0 bg-transparent p-0"
          />
          <div className="space-y-2">
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2 break-all font-mono text-[length:var(--fs-xs)] text-(--ui-fg) underline"
            >
              {service.url}
              <ExternalLink className="h-3 w-3" />
            </a>
            <Input
              type="password"
              autoComplete="off"
              disabled={!service.enabled}
              aria-label={`${service.name} credential`}
              className="min-h-11 rounded-none"
              value={props.credentials[service.credentialRef] ?? ""}
              onChange={(event) => props.setCredential(service.credentialRef, event.target.value)}
              placeholder={
                props.state.keyring.credentialRefs.includes(service.credentialRef)
                  ? "Stored in keyring"
                  : "Credential"
              }
            />
          </div>
          <ProbeControl
            target={service.id}
            probe={probeFor(props.state, service.id)}
            busy={props.busy === `probe:${service.id}`}
            disabled={!service.enabled}
            onProbe={props.probe}
          />
        </div>
      ))}
    </FormSection>
  );
}

export function RuntimeSearchStep(props: Props) {
  const runtimeRef = props.state.profile.runtime.credentialRef;
  const searchRef = props.state.profile.search.credentialRef;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FormSection
        icon={<Brain className="h-4 w-4" />}
        title="Remote inference"
        className="rounded-none"
      >
        <FormField label="OpenAI-compatible base URL">
          <Input
            className="min-h-11 rounded-none"
            value={props.state.profile.runtime.baseUrl}
            onChange={(event) =>
              props.updateProfile((profile) => ({
                ...profile,
                runtime: { ...profile.runtime, baseUrl: event.target.value },
              }))
            }
          />
        </FormField>
        <FormField label="Model ID">
          <Input
            className="min-h-11 rounded-none"
            value={props.state.profile.runtime.modelId}
            onChange={(event) =>
              props.updateProfile((profile) => ({
                ...profile,
                runtime: { ...profile.runtime, modelId: event.target.value },
              }))
            }
          />
        </FormField>
        <CredentialField
          credentialRef={runtimeRef}
          stored={props.state.keyring.credentialRefs.includes(runtimeRef)}
          value={props.credentials[runtimeRef] ?? ""}
          onChange={(value) => props.setCredential(runtimeRef, value)}
        />
        <ProbeControl
          target="runtime"
          probe={probeFor(props.state, "runtime")}
          busy={props.busy === "probe:runtime"}
          onProbe={props.probe}
        />
      </FormSection>
      <FormSection
        icon={<ScanSearch className="h-4 w-4" />}
        title="Native FastCRW search"
        className="rounded-none"
      >
        <CheckboxRow
          className="rounded-none"
          checked={props.state.profile.search.enabled}
          onChange={(enabled) =>
            props.updateProfile((profile) => ({
              ...profile,
              search: { ...profile.search, enabled },
            }))
          }
          label="Enable crw_search"
          description="Keyring-backed loopback proxy; bounded native HTTP search."
        />
        <FormField label="FastCRW base URL">
          <Input
            disabled={!props.state.profile.search.enabled}
            className="min-h-11 rounded-none"
            value={props.state.profile.search.baseUrl}
            onChange={(event) =>
              props.updateProfile((profile) => ({
                ...profile,
                search: { ...profile.search, baseUrl: event.target.value },
              }))
            }
          />
        </FormField>
        <CredentialField
          credentialRef={searchRef}
          stored={props.state.keyring.credentialRefs.includes(searchRef)}
          value={props.credentials[searchRef] ?? ""}
          onChange={(value) => props.setCredential(searchRef, value)}
        />
        <ProbeControl
          target="search"
          probe={probeFor(props.state, "search")}
          busy={props.busy === "probe:search"}
          disabled={!props.state.profile.search.enabled}
          onProbe={props.probe}
        />
      </FormSection>
    </div>
  );
}

export function EnrollmentReviewStep({
  state,
  requiredTargets,
  missingTargets,
  ready,
  replacementPending,
  recoveryRequired,
  busy,
  save,
  apply,
  revoke,
}: {
  state: OnboardingState;
  requiredTargets: readonly string[];
  missingTargets: readonly string[];
  ready: boolean;
  replacementPending: boolean;
  recoveryRequired: boolean;
  busy: string;
  save: () => Promise<OnboardingState | null>;
  apply: () => Promise<void>;
  revoke: () => Promise<void>;
}) {
  return (
    <FormSection
      icon={<ShieldCheck className="h-4 w-4" />}
      title="Authoritative enrollment"
      className="rounded-none"
    >
      <FactGrid
        facts={[
          ["Model", state.profile.runtime.modelId],
          ["Inference", state.profile.runtime.baseUrl],
          ["Local agents", state.profile.localAgents.join(" · ") || "None"],
          [
            "Remote agent",
            state.profile.remoteAgent.enabled ? state.profile.remoteAgent.target : "None",
          ],
          ["Required probes", requiredTargets.join(" · ")],
          ["Receipt", state.receipt?.profileDigest ?? "Not applied"],
        ]}
      />
      <div className="flex flex-wrap gap-3 border-t border-(--ui-separator) pt-4">
        <OnboardingButton
          busy={busy === "save"}
          disabled={recoveryRequired}
          onClick={() => void save()}
        >
          Save draft
        </OnboardingButton>
        {!state.receipt ? (
          <OnboardingButton
            intent="primary"
            busy={busy === "apply"}
            disabled={!ready || recoveryRequired}
            onClick={() => void apply()}
          >
            Apply verified enrollment
          </OnboardingButton>
        ) : null}
        {state.receipt || recoveryRequired ? (
          <OnboardingButton busy={busy === "revoke"} onClick={() => void revoke()}>
            {recoveryRequired ? "Retry recovery" : "Revoke and restore"}
          </OnboardingButton>
        ) : null}
      </div>
      {!ready && !state.receipt ? (
        <p role="status" className="text-[length:var(--fs-xs)] text-(--ui-muted)">
          Apply remains unavailable until current successful observations exist for:{" "}
          <span className="font-mono text-(--ui-fg)">
            {missingTargets.join(" · ") || "required targets"}
          </span>
          .
        </p>
      ) : null}
      {replacementPending ? (
        <p role="status" className="text-[length:var(--fs-xs)] text-(--ui-fg)">
          ⊭ contradicted · The saved profile differs from the active enrollment. Revoke and restore
          the active attachments before applying the replacement profile.
        </p>
      ) : null}
      {recoveryRequired ? (
        <p role="status" className="text-[length:var(--fs-xs)] text-(--ui-fg)">
          ⊭ contradicted · Recovery evidence is active. Profile edits, probes, save, and apply are
          unavailable until recovery succeeds.
        </p>
      ) : null}
    </FormSection>
  );
}
