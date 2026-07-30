"use client";

import { useCallback, useState } from "react";
import { DownloadCloud, Zap } from "@/ui/icon-registry";
import { Button, Input, Select, Spinner } from "@/ui";
import type { ModelDownload, StarterPreset, StudioDiagnostics } from "@/lib/types";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { TierSection, useModelIndex } from "@/features/recipes/recipes-content/picks-shared";
import { useSetupRecommendations, type SetupRecommendation } from "../recommendations";
import type { GgufFileOption } from "../setup-model-files";

export interface ApimClientFields {
  issuer_id: string;
  client_id: string;
  client_secret: string;
  token_endpoint: string;
  audience: string;
  scopes: string;
  path_style: "openai" | "azure";
  api_version: string;
}

const apimClientFieldsFromPreset = (preset: StarterPreset): ApimClientFields => ({
  issuer_id: preset.remote?.issuer_id ?? "",
  client_id: preset.remote?.client_id ?? "",
  client_secret: "",
  token_endpoint: preset.remote?.token_endpoint ?? "",
  audience: preset.remote?.audience ?? "",
  scopes: preset.remote?.scopes?.join(" ") ?? "",
  path_style: preset.remote?.path_style ?? "openai",
  api_version: preset.remote?.api_version ?? "",
});

const NO_DOWNLOADS: Map<string, ModelDownload> = new Map();
const NO_STARTING: Set<string> = new Set();

/**
 * Model selection, benchmark-led: the first thing shown is the pareto frontier of
 * configs we have actually measured that fit this rig (size x 1.5 headroom), each with
 * its expected decode speed. The generic catalog and the raw HF input stay available,
 * but they are the fallback, not the greeting.
 */

function RecommendationRow({
  recommendation,
  onDownload,
}: {
  recommendation: SetupRecommendation;
  onDownload: (hfId: string) => void;
}) {
  const quantBadge = recommendation.quant.toUpperCase();
  return (
    <div className="group flex items-center gap-4 border-b border-(--ui-border)/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-(--ui-hover)/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[length:var(--fs-md)] text-(--fg)">
            {recommendation.name}
          </span>
          <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-(--ui-muted)">
            {quantBadge}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-(--ui-muted)">
          <span>{recommendation.filesize}</span>
          <span>·</span>
          <span>needs ~{recommendation.requiredGb} GB</span>
          {recommendation.measuredOnThisClass ? (
            <>
              <span>·</span>
              <span className="text-(--ui-success)">measured on your class</span>
            </>
          ) : null}
        </div>
      </div>
      {recommendation.decodeTps !== null ? (
        <div className="shrink-0 text-right">
          <div className="font-mono text-[length:var(--fs-md)] tabular-nums text-(--fg)">
            {Math.round(recommendation.decodeTps)}
            <span className="ml-1 text-[11px] text-(--ui-muted)">tok/s</span>
          </div>
          {recommendation.engine ? (
            <div className="font-mono text-[10px] uppercase text-(--ui-muted)">
              {recommendation.engine}
            </div>
          ) : null}
        </div>
      ) : null}
      <Button
        size="sm"
        onClick={() => onDownload(recommendation.hfId)}
        icon={<DownloadCloud className="h-3.5 w-3.5" />}
      >
        Get
      </Button>
    </div>
  );
}

function RemotePresetRow({
  preset,
  remoteApiKey,
  setRemoteApiKey,
  remoteSubscriptionKey,
  setRemoteSubscriptionKey,
  connectingRemote,
  remoteError,
  connectRemotePreset,
}: {
  preset: StarterPreset;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  remoteSubscriptionKey: { header: string; value: string };
  setRemoteSubscriptionKey: (value: { header: string; value: string }) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset, apimClientFields?: ApimClientFields) => void;
}) {
  const isApimClient = preset.remote?.authentication === "apim_client";
  const [apimFields, setApimFields] = useState<ApimClientFields>(() =>
    apimClientFieldsFromPreset(preset),
  );
  const authLabel =
    preset.remote?.authentication === "none"
      ? "Keyless"
      : preset.remote?.authentication === "api_key"
        ? "API key"
        : "APIM client credentials";
  const handleConnect = () => {
    if (isApimClient) {
      connectRemotePreset(preset, apimFields);
    } else {
      connectRemotePreset(preset);
    }
  };
  return (
    <div className="border border-(--ui-border) bg-(--ui-surface) px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-md)] text-(--fg)">{preset.name}</div>
          <div className="truncate font-mono text-[11px] text-(--ui-muted)">
            {preset.remote?.model || "Models discovered at setup"}
          </div>
          <div className="font-mono text-[11px] text-(--ui-muted)">
            Authentication · {authLabel}
          </div>
        </div>
        <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[10px] uppercase text-(--ui-muted)">
          remote
        </span>
      </div>
      {isApimClient ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={apimFields.issuer_id}
              onChange={(event) => setApimFields({ ...apimFields, issuer_id: event.target.value })}
              placeholder="Issuer ID"
            />
            <Input
              value={apimFields.client_id}
              onChange={(event) => setApimFields({ ...apimFields, client_id: event.target.value })}
              placeholder="Client ID"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={apimFields.client_secret}
              onChange={(event) =>
                setApimFields({ ...apimFields, client_secret: event.target.value })
              }
              placeholder="Client secret"
            />
            <Input
              value={apimFields.token_endpoint}
              onChange={(event) =>
                setApimFields({ ...apimFields, token_endpoint: event.target.value })
              }
              placeholder="Token endpoint"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={apimFields.audience}
              onChange={(event) => setApimFields({ ...apimFields, audience: event.target.value })}
              placeholder="Audience"
            />
            <Input
              value={apimFields.scopes}
              onChange={(event) => setApimFields({ ...apimFields, scopes: event.target.value })}
              placeholder="Scopes (space-separated)"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={apimFields.path_style}
              onChange={(event) =>
                setApimFields({
                  ...apimFields,
                  path_style: event.target.value as "openai" | "azure",
                })
              }
              placeholder="Path style"
              options={[
                { value: "openai", label: "OpenAI" },
                { value: "azure", label: "Azure" },
              ]}
            />
            <Input
              value={apimFields.api_version}
              onChange={(event) =>
                setApimFields({ ...apimFields, api_version: event.target.value })
              }
              placeholder="API version (optional)"
            />
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connectingRemote}
              icon={connectingRemote ? <Spinner size="xs" /> : <Zap className="h-3.5 w-3.5" />}
            >
              {connectingRemote ? "Verifying" : "Verify and connect"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={remoteSubscriptionKey.header}
              onChange={(event) =>
                setRemoteSubscriptionKey({
                  ...remoteSubscriptionKey,
                  header: event.target.value,
                })
              }
              placeholder={
                preset.remote?.subscription_key_header ?? "Subscription header (optional)"
              }
            />
            <Input
              type="password"
              value={remoteSubscriptionKey.value}
              onChange={(event) =>
                setRemoteSubscriptionKey({
                  ...remoteSubscriptionKey,
                  value: event.target.value,
                })
              }
              placeholder="Subscription key (optional)"
            />
          </div>
          {remoteError ? <div className="mt-2 text-xs text-(--err)">{remoteError}</div> : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            {preset.remote?.authentication === "api_key" ? (
              <Input
                type="password"
                value={remoteApiKey}
                onChange={(event) => setRemoteApiKey(event.target.value)}
                placeholder="API key"
              />
            ) : (
              <div className="flex min-h-11 flex-1 items-center border border-(--ui-border) px-3 font-mono text-[11px] text-(--ui-muted)">
                No credential is sent
              </div>
            )}
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connectingRemote}
              icon={connectingRemote ? <Spinner size="xs" /> : <Zap className="h-3.5 w-3.5" />}
            >
              {connectingRemote ? "Verifying" : "Verify and connect"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={remoteSubscriptionKey.header}
              onChange={(event) =>
                setRemoteSubscriptionKey({
                  ...remoteSubscriptionKey,
                  header: event.target.value,
                })
              }
              placeholder={
                preset.remote?.subscription_key_header ?? "Subscription header (optional)"
              }
            />
            <Input
              type="password"
              value={remoteSubscriptionKey.value}
              onChange={(event) =>
                setRemoteSubscriptionKey({
                  ...remoteSubscriptionKey,
                  value: event.target.value,
                })
              }
              placeholder="Subscription key (optional)"
            />
          </div>
          {remoteError ? <div className="mt-2 text-xs text-(--err)">{remoteError}</div> : null}
        </div>
      )}
    </div>
  );
}

export function StepModel({
  presets,
  beginPresetSetup,
  remoteApiKey,
  setRemoteApiKey,
  remoteSubscriptionKey,
  setRemoteSubscriptionKey,
  connectingRemote,
  remoteError,
  connectRemotePreset,
  diagnostics,
  maxVram,
  manualModelId,
  setManualModelId,
  manualGgufOptions,
  manualGgufFile,
  setManualGgufFile,
  resolvingManualModel,
  beginVariantDownload,
  submitManualModel,
}: {
  presets: StarterPreset[];
  beginPresetSetup: (preset: StarterPreset) => void;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  remoteSubscriptionKey: { header: string; value: string };
  setRemoteSubscriptionKey: (value: { header: string; value: string }) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset, apimClientFields?: ApimClientFields) => void;
  diagnostics: StudioDiagnostics | null;
  maxVram: number;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  manualGgufOptions: GgufFileOption[];
  manualGgufFile: string;
  setManualGgufFile: (value: string) => void;
  resolvingManualModel: boolean;
  beginVariantDownload: (modelId: string, allowPatterns?: string[]) => void;
  submitManualModel: () => void;
}) {
  const recommendations = useSetupRecommendations(diagnostics, maxVram);
  const [showCatalog, setShowCatalog] = useState(false);
  const { data: catalog } = useModelIndex();
  const tiers = catalog?.tiers ?? [];
  const remotePresets = presets.filter((preset) => preset.kind === "remote");
  const localPresets = presets.filter((preset) => preset.kind !== "remote");

  const handleRecommendationDownload = useCallback(
    (hfId: string) => {
      // Prefer the preset pipeline when one exists for this repo (it carries launch
      // config); otherwise download the repo directly.
      const preset = localPresets.find((candidate) => candidate.model_id === hfId);
      if (preset) beginPresetSetup(preset);
      else beginVariantDownload(hfId);
    },
    [localPresets, beginPresetSetup, beginVariantDownload],
  );

  const handleCatalogDownload = useCallback(
    (variant: ModelIndexVariant) =>
      beginVariantDownload(
        variant.repo,
        variant.allow_patterns?.length ? variant.allow_patterns : undefined,
      ),
    [beginVariantDownload],
  );

  return (
    <div className="space-y-8">
      {recommendations.length > 0 ? (
        <div>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--ui-muted)">
              Measured on hardware like yours
            </span>
            <span className="font-mono text-[11px] text-(--ui-muted)">
              {maxVram > 0 ? `${Math.round(maxVram)} GB pool` : null}
            </span>
          </div>
          <div className="overflow-hidden border border-(--ui-border) bg-(--ui-surface)">
            {recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.hfId}
                recommendation={recommendation}
                onDownload={handleRecommendationDownload}
              />
            ))}
          </div>
        </div>
      ) : null}

      {remotePresets.length > 0 ? (
        <div className="space-y-2">
          {remotePresets.map((preset) => (
            <RemotePresetRow
              key={preset.id}
              preset={preset}
              remoteApiKey={remoteApiKey}
              setRemoteApiKey={setRemoteApiKey}
              remoteSubscriptionKey={remoteSubscriptionKey}
              setRemoteSubscriptionKey={setRemoteSubscriptionKey}
              connectingRemote={connectingRemote}
              remoteError={remoteError}
              connectRemotePreset={connectRemotePreset}
            />
          ))}
        </div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => setShowCatalog((value) => !value)}
          className="px-1 font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--ui-muted) transition-colors hover:text-(--fg)"
        >
          {showCatalog ? "Hide full catalog" : "Browse the full catalog"}
        </button>
        {showCatalog ? (
          <div className="mt-3 space-y-5">
            {tiers.map((tier) => (
              <TierSection
                key={tier.id}
                tier={tier}
                poolGb={maxVram}
                downloadsByModel={NO_DOWNLOADS}
                startingModelIds={NO_STARTING}
                onDownload={handleCatalogDownload}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-2 px-1 font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.18em] text-(--ui-muted)">
          Or any Hugging Face repo
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={manualModelId}
              onChange={(event) => setManualModelId(event.target.value)}
              placeholder="org/model-name"
            />
          </div>
          <Button
            variant="secondary"
            onClick={submitManualModel}
            disabled={resolvingManualModel}
            icon={
              resolvingManualModel ? <Spinner size="xs" /> : <DownloadCloud className="h-4 w-4" />
            }
          >
            {resolvingManualModel ? "Inspecting" : "Download"}
          </Button>
        </div>
        {manualGgufOptions.length > 1 ? (
          <div className="mt-3">
            <Select
              label="GGUF weights file"
              value={manualGgufFile}
              onChange={(event) => setManualGgufFile(event.target.value)}
              placeholder="Choose one quantization"
              options={manualGgufOptions}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
