"use client";

import { useState } from "react";
import { EnterpriseAccessSection } from "@/features/settings/enterprise-access-section";
import { Alert, Button, CheckboxRow, FormField, FormSection, Input, Select, Spinner } from "@/ui";
import { KeyRound, ShieldCheck } from "@/ui/icon-registry";
import {
  useCommissioningProfile,
  type CommissioningProfileController,
} from "../use-commissioning-profile";

type OidcTextKey = "issuer" | "client_id" | "audience" | "tenant_or_realm";

const OIDC_FIELDS: readonly { key: OidcTextKey; label: string }[] = [
  { key: "issuer", label: "Issuer URL" },
  { key: "client_id", label: "Client ID" },
  { key: "audience", label: "API audience" },
  { key: "tenant_or_realm", label: "Tenant or realm" },
];

const saveProfileInput = (profile: NonNullable<CommissioningProfileController["profile"]>) => ({
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

function ControllerConnection() {
  const [url, setUrl] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (credential.length > 32_768) throw new Error("Controller credential is too large");
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(url.trim() ? { backendUrl: url.trim() } : {}),
      });
      if (!response.ok) throw new Error(`Controller settings returned HTTP ${response.status}`);
      const settings = (await response.json()) as { backendUrl?: unknown };
      if (credential) await storeCredential(String(settings.backendUrl ?? url.trim()), credential);
      setCredential("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Controller connection was not stored");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ControllerConnectionView
      url={url}
      credential={credential}
      busy={busy}
      error={error}
      setUrl={setUrl}
      setCredential={setCredential}
      save={save}
    />
  );
}

const storeCredential = async (backendUrl: string, apiKey: string): Promise<void> => {
  const response = await fetch("/api/settings/controller-credential", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ backendUrl, apiKey }),
  });
  if (!response.ok) throw new Error(`Controller credential returned HTTP ${response.status}`);
};

function ControllerConnectionView(props: {
  url: string;
  credential: string;
  busy: boolean;
  error: string;
  setUrl: (value: string) => void;
  setCredential: (value: string) => void;
  save: () => Promise<void>;
}) {
  return (
    <FormSection
      icon={<KeyRound className="h-4 w-4" />}
      title="Controller connection"
      className="rounded-none"
    >
      {props.error ? <Alert variant="error">{props.error}</Alert> : null}
      <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
        Store the controller credential in the deployment keyring. Secret values are write-only.
      </p>
      <ControllerFields {...props} />
      <Button
        className="min-h-11"
        variant="secondary"
        disabled={props.busy}
        onClick={() => void props.save()}
      >
        {props.busy ? "Storing…" : "Store controller connection"}
      </Button>
    </FormSection>
  );
}

function ControllerFields(props: {
  url: string;
  credential: string;
  setUrl: (value: string) => void;
  setCredential: (value: string) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField label="Controller URL">
        <Input
          className="min-h-11 rounded-none font-mono"
          value={props.url}
          onChange={(event) => props.setUrl(event.target.value)}
          placeholder="http://127.0.0.1:8080"
        />
      </FormField>
      <FormField label="Controller credential">
        <Input
          type="password"
          autoComplete="off"
          className="min-h-11 rounded-none font-mono"
          value={props.credential}
          onChange={(event) => props.setCredential(event.target.value)}
          placeholder="Leave blank to preserve existing"
        />
      </FormField>
    </div>
  );
}

function OidcTextFields({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile!;
  return OIDC_FIELDS.map(({ key, label }) => (
    <FormField key={key} label={label}>
      <Input
        className="min-h-11 rounded-none font-mono"
        disabled={!profile.oidc.enabled}
        value={profile.oidc[key]}
        onChange={(event) =>
          controller.setProfile({
            ...profile,
            oidc: { ...profile.oidc, [key]: event.target.value },
          })
        }
      />
    </FormField>
  ));
}

function OidcCommissioning({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile;
  if (!profile) {
    return (
      <div className="flex min-h-20 items-center gap-3 text-(--ui-muted)">
        <Spinner />
        <span>Loading issuer configuration…</span>
      </div>
    );
  }
  return (
    <>
      <CheckboxRow
        className="rounded-none"
        checked={profile.oidc.enabled}
        onChange={(enabled) =>
          controller.setProfile({ ...profile, oidc: { ...profile.oidc, enabled } })
        }
        label="Commission an enterprise issuer"
        description="Discovery can be validated here. Runtime activation remains deployment-owned."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <OidcKindField controller={controller} />
        <OidcTextFields controller={controller} />
        <OidcActions controller={controller} />
      </div>
      <OidcEvidence controller={controller} />
    </>
  );
}

function OidcKindField({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile!;
  return (
    <FormField label="Issuer type">
      <Select
        className="min-h-11 rounded-none"
        disabled={!profile.oidc.enabled}
        value={profile.oidc.kind}
        options={[
          { value: "entra", label: "Microsoft Entra ID" },
          { value: "keycloak", label: "Keycloak" },
        ]}
        onChange={(event) =>
          controller.setProfile({
            ...profile,
            oidc: { ...profile.oidc, kind: event.target.value as "entra" | "keycloak" },
          })
        }
      />
    </FormField>
  );
}

function OidcActions({ controller }: { controller: CommissioningProfileController }) {
  const profile = controller.profile!;
  return (
    <div className="flex items-end gap-2">
      <Button
        className="min-h-11"
        variant="secondary"
        disabled={Boolean(controller.busy)}
        onClick={() => void controller.save(saveProfileInput(profile))}
      >
        {controller.busy === "save" ? "Saving…" : "Save issuer metadata"}
      </Button>
      <Button
        className="min-h-11"
        disabled={Boolean(controller.busy) || !profile.oidc.enabled}
        onClick={() => void controller.probe("oidc")}
      >
        {controller.busy === "probe:oidc" ? "Discovering…" : "Probe discovery"}
      </Button>
    </div>
  );
}

function OidcEvidence({ controller }: { controller: CommissioningProfileController }) {
  const probe = controller.profile!.oidc.probe;
  return (
    <div
      aria-live="polite"
      className="border border-(--ui-separator) bg-(--ui-bg) p-4 text-[length:var(--fs-sm)]"
    >
      <span className="font-mono uppercase">{probe.state}</span>
      <span className="ml-3 text-(--ui-muted)">{probe.detail}</span>
    </div>
  );
}

function OidcSection() {
  const controller = useCommissioningProfile();
  return (
    <FormSection
      icon={<ShieldCheck className="h-4 w-4" />}
      title="OIDC deployment handoff"
      className="rounded-none"
    >
      {controller.error ? <Alert variant="error">{controller.error}</Alert> : null}
      <OidcCommissioning controller={controller} />
    </FormSection>
  );
}

export function StepAccess() {
  return (
    <div className="space-y-7">
      <ControllerConnection />
      <OidcSection />
      <EnterpriseAccessSection returnTo="/setup?track=access" />
    </div>
  );
}
