"use client";

import { Schema } from "effect";
import { useCallback, useState } from "react";
import { CredentialStoreResponseSchema } from "@shared/agent/credential-store-contract";
import { Alert, Button, Input, Select } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { requestJson } from "@/features/integrations/google-account-model";
import { SettingsGroup, SettingsRow } from "./settings-ui";

const CREDENTIAL_STORE_URL = "/api/agent/accounts/credential-store";
const decodeCredentialStore = Schema.decodeUnknownSync(CredentialStoreResponseSchema);
const PROVIDERS = [
  ["keyring", "System keyring"],
  ["onepassword", "1Password"],
  ["keeper", "Keeper Secrets Manager"],
  ["lastpass", "LastPass"],
  ["dashlane", "Dashlane"],
  ["bw", "Bitwarden Password Manager"],
  ["bws", "Bitwarden Secrets Manager"],
  ["vault", "HashiCorp Vault"],
  ["openbao", "OpenBao"],
  ["awssm", "AWS Secrets Manager"],
  ["awsps", "AWS Parameter Store"],
  ["gcsm", "Google Cloud Secret Manager"],
  ["akv", "Azure Key Vault"],
  ["infisical", "Infisical"],
  ["scaleway", "Scaleway Secret Manager"],
  ["keepass", "KeePass KDBX"],
  ["pass", "Pass"],
  ["gopass", "Gopass"],
  ["protonpass", "Proton Pass"],
  ["passbolt", "Passbolt"],
  ["age", "age-encrypted file"],
  ["sops", "SOPS"],
] as const;

const knownProvider = (provider: string) => PROVIDERS.some(([id]) => id === provider);

export function CredentialStoreSection() {
  const [provider, setProvider] = useState("keyring");
  const [selection, setSelection] = useState("keyring");
  const [customProvider, setCustomProvider] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    void requestJson(CREDENTIAL_STORE_URL, decodeCredentialStore, { cache: "no-store" })
      .then((result) => {
        setProvider(result.provider);
        setSelection(knownProvider(result.provider) ? result.provider : "custom");
        setCustomProvider(knownProvider(result.provider) ? "" : result.provider);
        setError("");
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Credential store failed");
      })
      .finally(() => setLoading(false));
  }, []);

  useMountSubscription(load, [load]);
  const nextProvider = selection === "custom" ? customProvider.trim() : selection;
  const dirty = nextProvider.length > 0 && nextProvider !== provider;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const result = await requestJson(CREDENTIAL_STORE_URL, decodeCredentialStore, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: nextProvider }),
      });
      setProvider(result.provider);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Credential store failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup
      title="Credential store"
      description="One SecretSpec provider protects every account credential used by Local Studio."
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      <SettingsRow
        label="Secret provider"
        description="Changing providers migrates existing credentials before making the new store active."
        control={
          <Select
            compact
            aria-label="Secret provider"
            value={selection}
            disabled={loading || saving}
            onChange={(event) => {
              setSelection(event.target.value);
              setSaved(false);
            }}
            options={[
              ...PROVIDERS.map(([value, label]) => ({ value, label })),
              { value: "custom", label: "SecretSpec alias or URI" },
            ]}
          />
        }
      />
      {selection === "custom" ? (
        <SettingsRow
          label="Provider alias or URI"
          description="Use an alias from SecretSpec configuration or a complete provider URI."
          control={
            <Input
              value={customProvider}
              onChange={(event) => {
                setCustomProvider(event.target.value);
                setSaved(false);
              }}
              placeholder="onepassword://Production"
              autoComplete="off"
              className="w-64 font-mono"
            />
          }
        />
      ) : null}
      <div className="flex items-center justify-end gap-2 px-3 py-2">
        {saved ? (
          <span className="text-[length:var(--fs-xs)] text-(--ui-success)">Saved</span>
        ) : null}
        <Button size="sm" loading={saving} disabled={!dirty || loading} onClick={() => void save()}>
          Save credential store
        </Button>
      </div>
    </SettingsGroup>
  );
}
