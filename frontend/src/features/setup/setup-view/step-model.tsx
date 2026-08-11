"use client";

import { useCallback, useState } from "react";
import { DownloadCloud, Zap } from "@/ui/icon-registry";
import { Button, Input, Select, Spinner } from "@/ui";
import type { ModelDownload, StarterPreset, StudioDiagnostics } from "@/lib/types";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { TierSection, useModelIndex } from "@/features/recipes/recipes-content/picks-shared";
import { useSetupRecommendations, type SetupRecommendation } from "../recommendations";
import type { GgufFileOption } from "../setup-model-files";

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
          <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
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
            <div className="font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
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
  connectingRemote,
  remoteError,
  connectRemotePreset,
}: {
  preset: StarterPreset;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
}) {
  return (
    <div className="rounded-[10px] border border-(--ui-border) bg-(--ui-surface)/25 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-md)] text-(--fg)">{preset.name}</div>
          <div className="truncate font-mono text-[11px] text-(--ui-muted)">
            {preset.remote?.model}
          </div>
        </div>
        <span className="shrink-0 rounded border border-(--ui-border) px-1.5 py-px font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
          remote
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          type="password"
          value={remoteApiKey}
          onChange={(event) => setRemoteApiKey(event.target.value)}
          placeholder="API key"
        />
        <Button
          size="sm"
          onClick={() => connectRemotePreset(preset)}
          disabled={connectingRemote}
          icon={connectingRemote ? <Spinner size="xs" /> : <Zap className="h-3.5 w-3.5" />}
        >
          {connectingRemote ? "Connecting" : "Connect"}
        </Button>
      </div>
      {remoteError ? <div className="mt-2 text-xs text-(--err)">{remoteError}</div> : null}
    </div>
  );
}

export function StepModel({
  presets,
  beginPresetSetup,
  remoteApiKey,
  setRemoteApiKey,
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
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
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
            <span className="font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
              Measured on hardware like yours
            </span>
            <span className="font-mono text-[11px] text-(--ui-muted)">
              {maxVram > 0 ? `${Math.round(maxVram)} GB pool` : null}
            </span>
          </div>
          <div className="overflow-hidden rounded-[10px] border border-(--ui-border) bg-(--ui-surface)/25">
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
          className="px-1 font-mono text-[length:var(--fs-sm)] text-(--ui-muted) transition-colors hover:text-(--fg)"
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
        <div className="mb-2 px-1 font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
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
            icon={resolvingManualModel ? <Spinner size="xs" /> : <DownloadCloud className="h-4 w-4" />}
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
