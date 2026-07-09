"use client";

import { useMemo, useState } from "react";
import { Table, TBody, THead, TH, TRow, Spinner } from "@/ui";
import { LazyHuggingFaceModelCardPanel } from "@/ui/lazy-huggingface-model-card";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { originalModelKey } from "@/lib/huggingface";
import { ModelRow } from "./model-row";

export function DiscoverResults({
  models,
  filteredModels,
  loading,
  error,
  providerFilter,
  copiedId,
  hasMore,
  isModelLocal,
  getDownloadForModel,
  startingModelIds,
  onCopyModelId,
  onRefresh,
  onLoadMore,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
}: {
  models: HuggingFaceModel[];
  filteredModels: HuggingFaceModel[];
  loading: boolean;
  error: string | null;
  providerFilter: string;
  copiedId: string | null;
  hasMore: boolean;
  isModelLocal: (modelId: string) => boolean;
  getDownloadForModel: (modelId: string) => ModelDownload | null;
  startingModelIds: Set<string>;
  onCopyModelId: (modelId: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
}) {
  const [selectedModelCard, setSelectedModelCard] = useState<{
    model: HuggingFaceModel;
    variants: HuggingFaceModel[];
  } | null>(null);
  const variantsByKey = useMemo(() => {
    const groups = new Map<string, HuggingFaceModel[]>();
    filteredModels.forEach((model) => {
      const key = originalModelKey(model);
      const existing = groups.get(key);
      if (existing) {
        existing.push(model);
      } else {
        groups.set(key, [model]);
      }
    });
    return groups;
  }, [filteredModels]);

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-(--err) mb-4">{error}</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-(--fg) hover:bg-(--surface) transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && models.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-(--dim)">
        <Spinner size="lg" variant="refresh" />
      </div>
    );
  }

  if (filteredModels.length === 0) {
    return (
      <div className="text-center py-12 text-(--dim)">
        <p>No models found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <>
      <div className="text-xs text-(--dim) mb-3">
        {filteredModels.length} {filteredModels.length === 1 ? "model" : "models"}
        {providerFilter && ` from ${providerFilter}`}
      </div>

      <Table>
        <THead>
          <TRow className="hover:bg-transparent">
            <TH>Model</TH>
            <TH>Provider</TH>
            <TH>Task</TH>
            <TH>Quantization</TH>
            <TH>Status</TH>
            <TH align="right">Stats</TH>
            <TH align="right" className="w-8" />
            <TH align="right">Action</TH>
          </TRow>
        </THead>
        <TBody>
          {filteredModels.map((model) => {
            const variants = variantsByKey.get(originalModelKey(model)) ?? [model];
            return (
              <ModelRow
                key={model._id || model.modelId}
                model={model}
                copied={copiedId === model.modelId}
                isLocal={isModelLocal(model.modelId)}
                activeDownload={getDownloadForModel(model.modelId)}
                isStarting={startingModelIds.has(model.modelId)}
                onCopyModelId={onCopyModelId}
                onStartDownload={onStartDownload}
                onPauseDownload={onPauseDownload}
                onResumeDownload={onResumeDownload}
                onOpenModelCard={() => setSelectedModelCard({ model, variants })}
              />
            );
          })}
        </TBody>
      </Table>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-sm text-(--fg) hover:bg-(--surface) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Spinner variant="refresh" />
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}
      <LazyHuggingFaceModelCardPanel
        open={Boolean(selectedModelCard)}
        model={selectedModelCard?.model ?? null}
        variants={selectedModelCard?.variants ?? []}
        onClose={() => setSelectedModelCard(null)}
      />
    </>
  );
}
