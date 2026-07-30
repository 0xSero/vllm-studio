"use client";

import { Schema } from "effect";
import { useCallback, useState } from "react";
import { FoundryCatalogViewSchema } from "@local-studio/contracts/foundry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "./settings-ui";

type CatalogState = {
  models: string[];
  agents: string[];
  observedAt: string | null;
  error: string | null;
  loading: boolean;
};

const fetchCatalog = async (): Promise<Omit<CatalogState, "loading">> => {
  const [modelsResponse, agentsResponse] = await Promise.all([
    fetch("/api/proxy/ai/v1/models", { cache: "no-store" }),
    fetch("/api/proxy/ai/v1/agents", { cache: "no-store" }),
  ]);
  if (!modelsResponse.ok || !agentsResponse.ok) {
    throw new Error(
      `APIM catalog probe returned ${modelsResponse.status}/${agentsResponse.status}`,
    );
  }
  const [models, agents] = await Promise.all([
    modelsResponse.json().then(Schema.decodeUnknownSync(FoundryCatalogViewSchema)),
    agentsResponse.json().then(Schema.decodeUnknownSync(FoundryCatalogViewSchema)),
  ]);
  return {
    models: models.data.map((entry) => entry.id),
    agents: agents.data.map((entry) => entry.id),
    observedAt: [models.observed_at, agents.observed_at].sort().at(0) ?? null,
    error: null,
  };
};

export function FoundryCatalogSection({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<CatalogState>({
    models: [],
    agents: [],
    observedAt: null,
    error: null,
    loading: false,
  });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      setState({ ...(await fetchCatalog()), loading: false });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Catalog probe failed",
      }));
    }
  }, [enabled]);

  useMountSubscription(() => {
    void refresh();
    return undefined;
  }, [refresh]);

  return (
    <SettingsGroup
      title="Microsoft Foundry catalog"
      description="Models and project agents admitted by the APIM policy and provider allowlists."
      actions={
        <div className="flex items-center gap-2">
          <StatusPill tone={state.error ? "warning" : state.observedAt ? "good" : undefined}>
            {state.error ? "probe failed" : state.observedAt ? "live observed" : "not observed"}
          </StatusPill>
          <SettingsButton disabled={!enabled || state.loading} onClick={() => void refresh()}>
            {state.loading ? "Refreshing" : "Refresh"}
          </SettingsButton>
        </div>
      }
    >
      <SettingsRow
        label="Allowed models"
        description="Live APIM catalog response intersected with the deployment allowlist."
        value={
          <SettingsValue mono wrap>
            {state.models.join(", ") || "No observed models"}
          </SettingsValue>
        }
      />
      <SettingsRow
        label="Allowed project agents"
        description="Invocation remains subject, tenant, role, and clearance bound."
        value={
          <SettingsValue mono wrap>
            {state.agents.join(", ") || "No observed agents"}
          </SettingsValue>
        }
      />
      <SettingsRow
        label="Evidence"
        value={
          <SettingsValue mono>
            {state.observedAt
              ? `observed ${new Date(state.observedAt).toLocaleString()}`
              : (state.error ?? "pending sign-in")}
          </SettingsValue>
        }
      />
    </SettingsGroup>
  );
}
