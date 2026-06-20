import { ExternalLink, RefreshCw, Search } from "@/ui/icon-registry";
import { ModelButton, ModelSection, ModelInput, ModelRow, ModelValue, ModelStatus } from "@/ui";
import type { HuggingFaceModel } from "@/lib/types";
import { ExploreModelRow } from "./explore-model-row";
import { estimateRoughWeightsGb } from "./explore-model-stats";
import type { ModelFit } from "./hardware-profile";
import type { HardwareProfile, ModelGroup } from "./use-explore";

const FALLBACK_MODELS = [
  [
    "Qwen/Qwen3-32B",
    "Recent dense model family with strong local-serving coverage.",
    "~64 GB · text-generation",
  ],
  [
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    "Reasoning-oriented fallback suggestion for search and downloads.",
    "~64 GB · reasoning",
  ],
  [
    "microsoft/Phi-4-mini-instruct",
    "Small template row that keeps Explore useful on limited VRAM.",
    "~8 GB · compact",
  ],
] as const;

export const EXPLORE_TASKS = [
  { value: "", label: "All tasks" },
  { value: "text-generation", label: "Text generation" },
  { value: "text2text-generation", label: "Text-to-text" },
  { value: "conversational", label: "Conversational" },
  { value: "fill-mask", label: "Fill-mask" },
  { value: "question-answering", label: "Q&A" },
  { value: "summarization", label: "Summarization" },
] as const;

export const EXPLORE_LIBRARIES = [
  { value: "", label: "All libraries" },
  { value: "transformers", label: "Transformers" },
  { value: "pytorch", label: "PyTorch" },
  { value: "safetensors", label: "Safetensors" },
  { value: "gguf", label: "GGUF" },
  { value: "exl2", label: "EXL2" },
  { value: "awq", label: "AWQ" },
  { value: "gptq", label: "GPTQ" },
] as const;

export const EXPLORE_SORTS = [
  { value: "", label: "Relevance" },
  { value: "trendingScore", label: "Trending" },
  { value: "downloads", label: "Most downloaded" },
  { value: "likes", label: "Most liked" },
  { value: "createdAt", label: "Newest" },
] as const;

export function ExploreControls({
  groupsCount,
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  hardwareProfile,
  loading,
  error,
  search,
  setSearch,
  task,
  setTask,
  library,
  setLibrary,
  sort,
  setSort,
  setPoolOverrideGb,
  refresh,
}: {
  groupsCount: number;
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  hardwareProfile: HardwareProfile;
  loading: boolean;
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  task: string;
  setTask: (value: string) => void;
  library: string;
  setLibrary: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  setPoolOverrideGb: (value: number | null) => void;
  refresh: () => void;
}) {
  return (
    <ModelSection
      title="Explore controls"
      description="Search Hugging Face, filter by task/library, tune pooled VRAM."
      actions={
        <ModelStatus tone={loading ? "info" : error ? "warning" : "good"}>
          {loading ? "syncing" : error ? "fallback" : "ready"}
        </ModelStatus>
      }
    >
      <ExploreSearchRow
        groupsCount={groupsCount}
        search={search}
        setSearch={setSearch}
        refresh={refresh}
        loading={loading}
      />
      <ExploreFilterRow
        task={task}
        setTask={setTask}
        library={library}
        setLibrary={setLibrary}
        sort={sort}
        setSort={setSort}
      />
      <ExploreVramPoolRow
        maxVramGb={maxVramGb}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
        setPoolOverrideGb={setPoolOverrideGb}
      />
      <ExploreHardwareHintRow hardwareProfile={hardwareProfile} poolOverrideGb={poolOverrideGb} />
    </ModelSection>
  );
}

function ExploreFilterRow({
  task,
  setTask,
  library,
  setLibrary,
  sort,
  setSort,
}: {
  task: string;
  setTask: (value: string) => void;
  library: string;
  setLibrary: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <FilterSelect label="Task" value={task} options={EXPLORE_TASKS} onChange={setTask} />
      <FilterSelect
        label="Library"
        value={library}
        options={EXPLORE_LIBRARIES}
        onChange={setLibrary}
      />
      <FilterSelect label="Sort" value={sort} options={EXPLORE_SORTS} onChange={setSort} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[length:var(--fs-xs)] text-(--color-foreground-subtle)">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-(--ui-border) bg-(--ui-surface) px-2 text-[length:var(--fs-sm)] text-(--fg) focus:outline-none focus:ring-1 focus:ring-(--ui-info)"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExploreSearchRow({
  groupsCount,
  search,
  setSearch,
  refresh,
  loading,
}: {
  groupsCount: number;
  search: string;
  setSearch: (value: string) => void;
  refresh: () => void;
  loading: boolean;
}) {
  return (
    <ModelRow
      label="Search models"
      description="Repo id, family name, quantization tag, or provider."
      control={
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
          <ModelInput
            value={search}
            onChange={setSearch}
            placeholder="Search Hugging Face models"
            className="pl-8"
          />
        </div>
      }
      status={<ModelStatus>{groupsCount || "defaults"}</ModelStatus>}
      actions={
        <ModelButton onClick={refresh} disabled={loading} title="Refresh Explore">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </ModelButton>
      }
    />
  );
}

function ExploreVramPoolRow({
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  setPoolOverrideGb,
}: {
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  setPoolOverrideGb: (value: number | null) => void;
}) {
  return (
    <ModelRow
      label="VRAM pool"
      description="Manual pool wins; clearing the input returns to detected GPUs and server hints."
      control={
        <VramPoolInput
          detectedPoolGb={detectedPoolGb}
          poolOverrideGb={poolOverrideGb}
          setPoolOverrideGb={setPoolOverrideGb}
        />
      }
      status={
        <ModelStatus tone={maxVramGb > 0 ? "info" : "default"}>
          {maxVramGb > 0 ? `${Math.round(maxVramGb)} GB` : "auto"}
        </ModelStatus>
      }
      actions={
        poolOverrideGb != null ? (
          <ModelButton onClick={() => setPoolOverrideGb(null)}>Auto</ModelButton>
        ) : null
      }
    />
  );
}

function VramPoolInput({
  detectedPoolGb,
  poolOverrideGb,
  setPoolOverrideGb,
}: {
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  setPoolOverrideGb: (value: number | null) => void;
}) {
  return (
    <input
      key={poolOverrideGb === null ? "pool-auto" : `pool-${poolOverrideGb}`}
      type="number"
      inputMode="decimal"
      min={1}
      step={1}
      placeholder={detectedPoolGb > 0 ? String(Math.round(detectedPoolGb)) : "Auto"}
      defaultValue={poolOverrideGb === null ? "" : String(poolOverrideGb)}
      onBlur={(event) => updatePoolOverride(event.currentTarget, poolOverrideGb, setPoolOverrideGb)}
      className="h-7 w-full rounded-md border border-transparent bg-(--surface) px-2.5 text-[length:var(--fs-md)] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:bg-(--bg) focus:ring-1 focus:ring-(--hl1)/60"
      title="Override total VRAM pool for Explore."
    />
  );
}

function ExploreHardwareHintRow({
  hardwareProfile,
  poolOverrideGb,
}: {
  hardwareProfile: HardwareProfile;
  poolOverrideGb: number | null;
}) {
  return (
    <ModelRow
      label="Hardware profile"
      description={hardwareProfile.detail}
      value={<ModelValue>{hardwareProfile.label}</ModelValue>}
      status={<ModelStatus>{poolOverrideGb != null ? "manual" : "detected"}</ModelStatus>}
    />
  );
}

export function DownloadStatusSection({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <ModelSection
      title="Download status"
      description="Server-side download errors stay visible as rows."
    >
      <ModelRow
        label="Download worker"
        description="The model browser remains usable while the download endpoint recovers."
        value={<ModelValue dim>{error}</ModelValue>}
        status={<ModelStatus tone="danger">error</ModelStatus>}
      />
    </ModelSection>
  );
}

export function ExploreResultsSection({
  groups,
  expandedKeys,
  search,
  loading,
  error,
  hasMore,
  maxVramGb,
  downloadsByModel,
  startingModelIds,
  isLocal,
  toggleExpand,
  startDownload,
  pauseDownload,
  resumeDownload,
  loadMore,
  openModelCard,
}: {
  groups: ModelGroup[];
  expandedKeys: Set<string>;
  search: string;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  maxVramGb: number;
  downloadsByModel: Map<string, import("@/lib/types").ModelDownload>;
  startingModelIds: Set<string>;
  isLocal: (modelId: string) => boolean;
  toggleExpand: (key: string) => void;
  startDownload: (modelId: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  loadMore: () => void;
  openModelCard: (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => void;
}) {
  return (
    <ModelSection
      title="Model results"
      description="Original models stay at the top level; quantized derivatives appear only after expanding an original. Click any row for the model card."
      actions={
        <ModelStatus tone={groups.length ? "good" : error ? "warning" : "default"}>
          {groups.length ? `${groups.length} models` : "defaults"}
        </ModelStatus>
      }
    >
      {error ? <ExploreErrorRow error={error} /> : null}
      {groups.length > 0
        ? groups.flatMap((group) =>
            exploreGroupRows({
              group,
              expanded: expandedKeys.has(group.key),
              maxVramGb,
              downloadsByModel,
              startingModelIds,
              isLocal,
              toggleExpand,
              startDownload,
              pauseDownload,
              resumeDownload,
              openModelCard,
            }),
          )
        : fallbackRows(search, loading)}
      {hasMore && groups.length > 0 ? <LoadMoreRow loading={loading} loadMore={loadMore} /> : null}
    </ModelSection>
  );
}

function ExploreErrorRow({ error }: { error: string }) {
  return (
    <ModelRow
      label="Explore API"
      description="Remote discovery failed, so curated fallback rows are shown below."
      value={<ModelValue dim>{error}</ModelValue>}
      status={<ModelStatus tone="warning">fallback</ModelStatus>}
    />
  );
}

function LoadMoreRow({ loading, loadMore }: { loading: boolean; loadMore: () => void }) {
  return (
    <ModelRow
      label="More results"
      description="Fetch the next page from Hugging Face."
      value={
        <ModelValue dim>{loading ? "Loading next page…" : "Additional rows available"}</ModelValue>
      }
      status={<ModelStatus>{loading ? "loading" : "ready"}</ModelStatus>}
      actions={
        <ModelButton onClick={loadMore} disabled={loading}>
          Load more
        </ModelButton>
      }
    />
  );
}

function exploreGroupRows({
  group,
  expanded,
  maxVramGb,
  downloadsByModel,
  startingModelIds,
  isLocal,
  toggleExpand,
  startDownload,
  pauseDownload,
  resumeDownload,
  openModelCard,
}: {
  group: ModelGroup;
  expanded: boolean;
  maxVramGb: number;
  downloadsByModel: Map<string, import("@/lib/types").ModelDownload>;
  startingModelIds: Set<string>;
  isLocal: (modelId: string) => boolean;
  toggleExpand: (key: string) => void;
  startDownload: (modelId: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  openModelCard: (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => void;
}) {
  const rows = [
    <ExploreModelRow
      key={group.key}
      model={group.lead}
      isLocal={isLocal(group.lead.modelId)}
      activeDownload={downloadsByModel.get(group.lead.modelId) ?? null}
      isStarting={startingModelIds.has(group.lead.modelId)}
      onStartDownload={startDownload}
      onPauseDownload={pauseDownload}
      onResumeDownload={resumeDownload}
      variantCount={group.variants.length}
      expanded={expanded}
      onToggleExpand={group.variants.length > 1 ? () => toggleExpand(group.key) : undefined}
      displayDownloads={group.maxDownloads}
      displayLikes={group.maxLikes}
      weightEstimateGb={group.needGb}
      pooledVramGb={maxVramGb}
      fit={group.fit}
      onOpenModelCard={() => openModelCard(group.lead, group.variants, group.fit)}
    />,
  ];
  if (!expanded) return rows;
  return rows.concat(
    group.variants
      .slice(1)
      .map((variant) => (
        <ExploreModelRow
          key={variant._id}
          model={variant}
          isLocal={isLocal(variant.modelId)}
          activeDownload={downloadsByModel.get(variant.modelId) ?? null}
          isStarting={startingModelIds.has(variant.modelId)}
          onStartDownload={startDownload}
          onPauseDownload={pauseDownload}
          onResumeDownload={resumeDownload}
          variantCount={1}
          expanded={false}
          child
          weightEstimateGb={estimateRoughWeightsGb(variant)}
          pooledVramGb={maxVramGb}
          fit={group.fit}
          onOpenModelCard={() => openModelCard(variant, group.variants, group.fit)}
        />
      )),
  );
}

function fallbackRows(search: string, loading: boolean) {
  return FALLBACK_MODELS.map(([label, description, value]) => (
    <ModelRow
      key={label}
      label={label}
      description={fallbackDescription(search, description)}
      value={<ModelValue mono>{value}</ModelValue>}
      status={<ModelStatus>{loading ? "syncing" : "fallback"}</ModelStatus>}
      actions={
        <a
          href={`https://huggingface.co/${label}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[length:var(--fs-sm)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      }
    />
  ));
}

function fallbackDescription(search: string, description: string) {
  const query = search.trim();
  return query ? `No exact match yet for "${query}". ${description}` : description;
}

function updatePoolOverride(
  input: HTMLInputElement,
  poolOverrideGb: number | null,
  setPoolOverrideGb: (value: number | null) => void,
) {
  const trimmed = input.value.trim();
  if (!trimmed) {
    setPoolOverrideGb(null);
    return;
  }
  const parsed = parseFloat(trimmed.replace(/,/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    setPoolOverrideGb(parsed);
    return;
  }
  input.value = poolOverrideGb === null ? "" : String(poolOverrideGb);
}
