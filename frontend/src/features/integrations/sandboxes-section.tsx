"use client";

import { Schema } from "effect";
import { useState } from "react";
import {
  SandboxAccountsResponseSchema,
  type SandboxAccountEntry,
  type SandboxMachineProfile,
  type SandboxMachineProfileId,
  type SandboxProvider,
} from "@shared/agent/sandbox-account-contract";
import { Alert, Button, FormField, Input } from "@/ui";
import { Eye, EyeOff } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { requestJson } from "./google-account-model";

const ACCOUNT_URL = "/api/agent/accounts/sandboxes";
const decodeAccounts = Schema.decodeUnknownSync(SandboxAccountsResponseSchema);
const PROVIDER_NAME: Record<SandboxProvider, string> = { daytona: "Daytona", vercel: "Vercel" };

export function SandboxAccountModal({
  provider,
  accounts = [],
  onClose,
  onChanged,
}: {
  provider: SandboxProvider;
  accounts?: readonly SandboxAccountEntry[];
  onClose: () => void;
  onChanged: (accounts: readonly SandboxAccountEntry[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [endpoint, setEndpoint] = useState("https://app.daytona.io/api");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [workerImage, setWorkerImage] = useState("local-studio-controller:nightly");
  const [showSecrets, setShowSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = accounts.filter((account) => account.provider === provider);
  const valid =
    credential.trim().length > 0 &&
    (provider === "daytona"
      ? endpoint.trim().length > 0
      : teamId.trim().length > 0 && projectId.trim().length > 0 && workerImage.trim().length > 0);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(ACCOUNT_URL, decodeAccounts, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          provider === "daytona"
            ? {
                provider,
                label: label.trim() || undefined,
                apiKey: credential,
                endpoint: endpoint.trim(),
              }
            : {
                provider,
                label: label.trim() || undefined,
                token: credential,
                teamId: teamId.trim(),
                projectId: projectId.trim(),
                workerImage: workerImage.trim(),
              },
        ),
      });
      setCredential("");
      onChanged(result.accounts);
      onClose();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (accountId: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(
        `${ACCOUNT_URL}?accountId=${encodeURIComponent(accountId)}`,
        decodeAccounts,
        { method: "DELETE" },
      );
      onChanged(result.accounts);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResourceDrawer
      title={PROVIDER_NAME[provider]}
      icon={<ResourceLogo identity={provider} label={PROVIDER_NAME[provider]} />}
      status={connected.length ? `${connected.length} connected` : "Not connected"}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void connect()}>
            Add account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {connected.length ? (
          <ResourceDrawerSection title="Accounts">
            <div className="space-y-3 py-2">
              {connected.map((account) => (
                <MachineProfileEditor
                  key={account.id}
                  account={account}
                  busy={busy}
                  onBusy={setBusy}
                  onError={setError}
                  onChanged={onChanged}
                  onDisconnect={() => void disconnect(account.id)}
                />
              ))}
            </div>
          </ResourceDrawerSection>
        ) : null}
        <ResourceDrawerSection title="Connection">
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <FormField label="Label">
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Work account"
                autoComplete="off"
              />
            </FormField>
            {provider === "daytona" ? (
              <FormField label="API endpoint">
                <Input
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  autoComplete="off"
                  className="font-mono"
                />
              </FormField>
            ) : (
              <>
                <FormField label="Team ID">
                  <Input
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                    autoComplete="off"
                    className="font-mono"
                  />
                </FormField>
                <FormField label="Project ID">
                  <Input
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    autoComplete="off"
                    className="font-mono"
                  />
                </FormField>
                <FormField label="VCR image">
                  <Input
                    value={workerImage}
                    onChange={(event) => setWorkerImage(event.target.value)}
                    autoComplete="off"
                    className="font-mono"
                  />
                </FormField>
              </>
            )}
            <FormField label={provider === "daytona" ? "API key" : "Access token"}>
              <div className="relative">
                <Input
                  value={credential}
                  onChange={(event) => setCredential(event.target.value)}
                  type={showSecrets ? "text" : "password"}
                  autoComplete="off"
                  className="pr-10 font-mono"
                />
                <SecretVisibility
                  visible={showSecrets}
                  onToggle={() => setShowSecrets(!showSecrets)}
                />
              </div>
            </FormField>
          </div>
        </ResourceDrawerSection>
      </div>
    </ResourceDrawer>
  );
}

function MachineProfileEditor({
  account,
  busy,
  onBusy,
  onError,
  onChanged,
  onDisconnect,
}: {
  account: SandboxAccountEntry;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
  onChanged: (accounts: readonly SandboxAccountEntry[]) => void;
  onDisconnect: () => void;
}) {
  const [profiles, setProfiles] = useState<readonly SandboxMachineProfile[]>(account.profiles);
  const [defaultProfile, setDefaultProfile] = useState<SandboxMachineProfileId>(
    account.defaultProfile,
  );

  const updateProfile = (
    id: SandboxMachineProfileId,
    field: "cpu" | "memoryGiB" | "storage",
    rawValue: string,
  ) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) return;
    setProfiles((current) =>
      current.map((profile) => {
        if (profile.id !== id) return profile;
        if (field === "storage") {
          return { ...profile, storage: { mode: "fixed", gib: value } };
        }
        if (field === "cpu" && account.provider === "vercel") {
          return { ...profile, cpu: value, memoryGiB: value * 2 };
        }
        return { ...profile, [field]: value };
      }),
    );
  };

  const save = async () => {
    onBusy(true);
    onError("");
    try {
      const result = await requestJson(ACCOUNT_URL, decodeAccounts, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          configuration: {
            teamId: account.teamId,
            projectId: account.projectId,
            workerImage: account.workerImage,
            defaultProfile,
            profiles,
          },
        }),
      });
      onChanged(result.accounts);
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      onBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-(--ui-separator) p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)">{account.label}</div>
          <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {account.provider === "vercel" ? account.projectId : account.endpoint}
          </div>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      <div className="grid grid-cols-[minmax(5rem,1fr)_5rem_5rem_6rem] gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
        <span>Size</span>
        <span>CPU</span>
        <span>RAM</span>
        <span>Storage</span>
        {profiles.map((profile) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            provider={account.provider}
            active={defaultProfile === profile.id}
            onDefault={() => setDefaultProfile(profile.id)}
            onUpdate={(field, value) => updateProfile(profile.id, field, value)}
          />
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" loading={busy} onClick={() => void save()}>
          Save sizes
        </Button>
      </div>
    </section>
  );
}

function ProfileRow({
  profile,
  provider,
  active,
  onDefault,
  onUpdate,
}: {
  profile: SandboxMachineProfile;
  provider: SandboxProvider;
  active: boolean;
  onDefault: () => void;
  onUpdate: (field: "cpu" | "memoryGiB" | "storage", value: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onDefault}
        className={active ? "text-left text-(--ui-info)" : "text-left text-(--ui-fg)"}
      >
        {profile.label}
      </button>
      <Input
        type="number"
        min={1}
        max={32}
        value={profile.cpu}
        onChange={(event) => onUpdate("cpu", event.target.value)}
      />
      <Input
        type="number"
        min={1}
        value={profile.memoryGiB}
        disabled={provider === "vercel"}
        onChange={(event) => onUpdate("memoryGiB", event.target.value)}
      />
      {profile.storage.mode === "fixed" ? (
        <Input
          type="number"
          min={1}
          value={profile.storage.gib}
          onChange={(event) => onUpdate("storage", event.target.value)}
        />
      ) : (
        <div className="flex items-center px-2 text-(--ui-muted)">Managed</div>
      )}
    </>
  );
}

function SecretVisibility({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-(--ui-muted) hover:text-(--ui-fg)"
      aria-label={visible ? "Hide credential" : "Show credential"}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
