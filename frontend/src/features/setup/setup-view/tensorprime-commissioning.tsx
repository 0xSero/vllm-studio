"use client";

import type { SetupRemoteService } from "@local-studio/contracts/setup-commissioning";
import { Alert, Button, CheckboxRow, FormField, FormSection, Input, Spinner } from "@/ui";
import { Network } from "@/ui/icon-registry";
import {
  useCommissioningProfile,
  type CommissioningProfileController,
} from "../use-commissioning-profile";

const saveInput = (profile: NonNullable<CommissioningProfileController["profile"]>) => ({
  revision: profile.revision,
  requirements: profile.requirements,
  oidc: {
    enabled: profile.oidc.enabled,
    kind: profile.oidc.kind,
    issuer: profile.oidc.issuer,
    client_id: profile.oidc.client_id,
    audience: profile.oidc.audience,
    tenant_or_realm: profile.oidc.tenant_or_realm,
  },
  tensorprime_probes: profile.tensorprime_probes.map(({ probe: _probe, ...entry }) => entry),
});

function PhaseFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
        {label}
      </div>
      <div className="mt-1 break-all font-mono">{value}</div>
    </div>
  );
}

function PhaseBoundary({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile!;
  return (
    <div className="grid gap-3 border border-(--ui-separator) bg-(--ui-bg) p-4 text-[length:var(--fs-sm)] sm:grid-cols-3">
      <PhaseFact label="SPIFFE trust domain" value={profile.spiffe.trust_domain} />
      <PhaseFact label="Identity plane" value={profile.spiffe.identity_plane} />
      <PhaseFact label="Workload SVID" value={profile.spiffe.workload_svid} />
      <PhaseFact label="Service mTLS" value={profile.spiffe.service_mtls} />
      <p className="text-(--ui-muted) sm:col-span-2">{profile.spiffe.detail}</p>
    </div>
  );
}

const updateProjection = (
  controller: CommissioningProfileController,
  id: SetupRemoteService["id"],
  change: Partial<SetupRemoteService>,
) => {
  const profile = controller.profile!;
  controller.setProfile({
    ...profile,
    tensorprime_probes: profile.tensorprime_probes.map((entry) =>
      entry.id === id ? { ...entry, ...change } : entry,
    ),
  });
};

function ProjectionField(props: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={props.label}>
      <Input
        className="min-h-11 rounded-none font-mono"
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FormField>
  );
}

function ProjectionRow({
  controller,
  service,
}: {
  controller: CommissioningProfileController;
  service: SetupRemoteService;
}) {
  return (
    <section
      aria-label={`${service.label} probe projection`}
      className="border border-(--ui-separator) bg-(--ui-bg) p-4"
    >
      <CheckboxRow
        className="rounded-none"
        checked={service.enabled}
        onChange={(enabled) => updateProjection(controller, service.id, { enabled })}
        label={service.label}
        description={`${service.probe.state} · ${service.probe.detail} · Catalog source ${service.catalog_service_id ?? "user projection"}`}
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_0.7fr_auto]">
        <ProjectionField
          label="Base URL"
          value={service.base_url}
          disabled={!service.enabled}
          onChange={(base_url) => updateProjection(controller, service.id, { base_url })}
        />
        <ProjectionField
          label="Host override"
          value={service.host_header}
          disabled={!service.enabled}
          onChange={(host_header) => updateProjection(controller, service.id, { host_header })}
        />
        <ProjectionField
          label="Probe path"
          value={service.probe_path}
          disabled={!service.enabled}
          onChange={(probe_path) => updateProjection(controller, service.id, { probe_path })}
        />
        <ProjectionProbeButton controller={controller} service={service} />
      </div>
    </section>
  );
}

function ProjectionProbeButton({
  controller,
  service,
}: {
  controller: CommissioningProfileController;
  service: SetupRemoteService;
}) {
  return (
    <div className="flex items-end">
      <Button
        className="min-h-11"
        disabled={Boolean(controller.busy) || !service.enabled}
        onClick={() => void controller.probe(service.id)}
      >
        {controller.busy === `probe:${service.id}` ? "Probing…" : "Probe"}
      </Button>
    </div>
  );
}

function ProjectionEditor({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile;
  if (!profile) {
    return (
      <div className="flex min-h-20 items-center gap-3 text-(--ui-muted)">
        <Spinner />
        <span>Loading service routes…</span>
      </div>
    );
  }
  return (
    <>
      <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
        These user-editable probes project selected checks from the runtime-owned 13-endpoint
        catalog. They do not replace that deployment authority.
      </p>
      <PhaseBoundary controller={controller} />
      <div className="space-y-4">
        {profile.tensorprime_probes.map((service) => (
          <ProjectionRow key={service.id} controller={controller} service={service} />
        ))}
      </div>
      <Button
        className="min-h-11"
        variant="secondary"
        disabled={Boolean(controller.busy)}
        onClick={() => void controller.save(saveInput(profile))}
      >
        {controller.busy === "save" ? "Saving…" : "Save probe projections"}
      </Button>
    </>
  );
}

export function TensorPrimeCommissioning() {
  const controller = useCommissioningProfile();
  return (
    <FormSection
      icon={<Network className="h-4 w-4" />}
      title="TensorPrime service probes"
      className="rounded-none"
    >
      {controller.error ? <Alert variant="error">{controller.error}</Alert> : null}
      <ProjectionEditor controller={controller} />
    </FormSection>
  );
}
