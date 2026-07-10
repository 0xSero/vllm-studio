"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { Brain, Check, ChevronDown, Search, Server } from "@/ui/icon-registry";
import { getStoredBackendUrl } from "@/lib/api/connection";
import { loadSavedControllers } from "@/lib/api/controllers";
import type { AgentModel } from "@/features/agent/workspace/types";
import { cx } from "@/ui/utils";

type AgentModelPickerProps = {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (id: string) => void;
  loading: boolean;
};

type ModelGroup = { key: string; name: string; models: AgentModel[] };

type FlatItem =
  | { type: "model"; model: AgentModel; groupIndex: number }
  | { type: "header"; label: string };

export function AgentModelPicker({
  models,
  selectedModel,
  onSelect,
  loading,
}: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [activeControllerKey, setActiveControllerKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const controllerLabel = useActiveControllerLabel();
  const active = models.find((model) => model.id === selectedModel) ?? null;
  const groups = useMemo(() => groupModelsByController(models), [models]);
  const currentKey =
    activeControllerKey ?? (active ? controllerGroupKey(active) : null) ?? groups[0]?.key ?? null;
  const disabled = loading || models.length === 0;
  const triggerLabel = modelTriggerLabel(active, selectedModel, loading, models.length);
  // The selected model exists but isn't the one currently loaded — sending will
  // 503 until it's launched. Warn on the trigger so the user notices BEFORE they
  // send, and can switch to a running model from the dropdown.
  const selectedModelNotRunning = !loading && Boolean(active && active.active === false);

  const { flatItems, filteredGroups } = useMemo(() => {
    return buildFilteredView(models, groups, query, currentKey);
  }, [models, groups, query, currentKey]);

  const openDropdown = useCallback(() => {
    setQuery("");
    setHighlightedIndex(0);
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setQuery(value);
    setHighlightedIndex(0);
  }, []);

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      setHighlightedIndex((idx) => {
        const next = findNextModelIndex(flatItems, idx, direction);
        if (next != null) {
          setTimeout(() => {
            listRef.current
              ?.querySelector(`[data-idx="${next}"]`)
              ?.scrollIntoView({ block: "nearest" });
          }, 0);
        }
        return next ?? idx;
      });
    },
    [flatItems],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveHighlight(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveHighlight(-1);
      } else if (event.key === "Enter") {
        const item = flatItems[highlightedIndex];
        if (item?.type === "model") {
          event.preventDefault();
          onSelect(item.model.id);
          setOpen(false);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab" && !event.shiftKey) {
        if (!query && filteredGroups.length > 1) {
          event.preventDefault();
          const currentIdx = filteredGroups.findIndex((g) => g.key === currentKey);
          const nextGroup = filteredGroups[(currentIdx + 1) % filteredGroups.length];
          if (nextGroup) setActiveControllerKey(nextGroup.key);
        }
      }
    },
    [flatItems, highlightedIndex, moveHighlight, onSelect, query, filteredGroups, currentKey],
  );

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setOpen(false);
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <ModelPickerTrigger
        label={triggerLabel}
        title={active?.name || triggerLabel}
        disabled={disabled}
        open={open}
        notRunning={selectedModelNotRunning}
        onToggle={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else openDropdown();
        }}
      />
      {open ? (
        <div
          className="absolute bottom-full right-0 z-[80] mb-2 flex max-h-[468px] w-[420px] flex-col overflow-hidden rounded-[var(--rad-lg)] border border-(--color-popover-border) bg-(--color-popover) shadow-[0_24px_72px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.035)]"
          onPointerDown={stopToolbarEvent}
          onMouseDown={stopToolbarEvent}
          onKeyDown={handleKeyDown}
        >
          <div className="shrink-0 border-b border-(--color-popover-border) bg-(--color-popover-header) px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[length:var(--fs-sm)] font-medium text-(--fg)">
                Choose a model
              </span>
              <span className="font-mono text-[length:var(--fs-2xs)] text-(--dim)">
                {models.length} available
              </span>
            </div>
            <div className="flex h-8 items-center gap-2 rounded-md border border-(--color-popover-border) bg-(--color-input) px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Search models…"
                className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim)/60"
              />
              <kbd className="shrink-0 rounded border border-(--color-popover-border) bg-(--color-popover) px-1.5 py-0.5 font-mono text-[length:var(--fs-2xs)] text-(--dim)">
                esc
              </kbd>
            </div>
          </div>

          {!query && filteredGroups.length > 1 ? (
            <div className="shrink-0 border-b border-(--color-popover-border) px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em] text-(--dim)">
                <Server className="h-3 w-3" />
                Source
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                {filteredGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setActiveControllerKey(group.key)}
                    className={cx(
                      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[length:var(--fs-2xs)] transition-colors active:translate-y-px",
                      group.key === currentKey
                        ? "border-(--color-popover-border) bg-(--color-input) text-(--fg)"
                        : "border-transparent text-(--dim) hover:bg-(--hover) hover:text-(--fg)",
                    )}
                  >
                    {group.name || controllerLabel || "local"}
                    <span className="text-(--dim)">{group.models.length}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {flatItems.length === 0 ? (
              <div className="px-3 py-8 text-center text-[length:var(--fs-sm)] text-(--dim)">
                No models match &ldquo;{query}&rdquo;.
              </div>
            ) : (
              flatItems.map((item, index) =>
                item.type === "header" ? (
                  <div
                    key={`header-${item.label}`}
                    className="px-2.5 pb-1 pt-2.5 font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em] text-(--dim)"
                  >
                    {item.label}
                  </div>
                ) : (
                  <ModelOption
                    key={item.model.id}
                    model={item.model}
                    selected={item.model.id === selectedModel}
                    highlighted={index === highlightedIndex}
                    dataIdx={index}
                    onSelect={(modelId) => {
                      onSelect(modelId);
                      setOpen(false);
                    }}
                    onHover={() => setHighlightedIndex(index)}
                  />
                ),
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelPickerTrigger({
  label,
  title,
  disabled,
  open,
  notRunning,
  onToggle,
}: {
  label: string;
  title: string;
  disabled: boolean;
  open: boolean;
  /** Selected model isn't the one loaded — sending will 503 until it launches. */
  notRunning: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
      onClick={onToggle}
      disabled={disabled}
      className={cx(
        "group/model inline-flex !h-7 !min-h-7 !min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 font-mono text-[length:var(--fs-xs)] text-(--dim) transition-colors hover:border-(--color-popover-border) hover:bg-(--hover) hover:text-(--fg) active:translate-y-px disabled:opacity-60",
        open && "border-(--color-popover-border) bg-(--color-input) text-(--fg)",
      )}
      title={notRunning ? `${title} is not running — launch it or pick a running model` : title}
      aria-label={`Model: ${title}${notRunning ? " (not running)" : ""}`}
    >
      <span className="relative shrink-0">
        <Brain className="h-3.5 w-3.5" />
        {notRunning ? (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-(--warn)/80 ring-1 ring-(--bg)" />
        ) : null}
      </span>
      <span className={cx("inline-block max-w-[148px] truncate whitespace-nowrap align-middle")}>
        {label}
      </span>
      <ChevronDown className={cx("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  );
}

function ModelOption({
  model,
  selected,
  highlighted,
  dataIdx,
  onSelect,
  onHover,
}: {
  model: AgentModel;
  selected: boolean;
  highlighted: boolean;
  dataIdx: number;
  onSelect: (modelId: string) => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      data-idx={dataIdx}
      onClick={() => onSelect(model.id)}
      onMouseEnter={onHover}
      className={cx(
        "flex w-full min-w-0 items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors",
        highlighted ? "border-(--color-popover-border) bg-(--hover)" : "",
        selected && !highlighted ? "border-(--color-popover-border) bg-(--color-input)" : "",
      )}
    >
      <span
        className={cx(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
          selected
            ? "border-(--accent)/35 bg-(--accent)/15 text-(--accent)"
            : "border-(--color-popover-border) text-transparent",
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[length:var(--fs-sm)] text-(--fg)">
            {model.rawId || model.name}
          </span>
          {model.reasoning ? (
            <span
              className="shrink-0 rounded-[3px] bg-(--accent)/15 px-1 text-[length:var(--fs-2xs)] text-(--accent)"
              title="Reasoning model"
            >
              R
            </span>
          ) : null}
          {model.vision ? (
            <span
              className="shrink-0 rounded-[3px] bg-(--hl2)/15 px-1 text-[length:var(--fs-2xs)] text-(--hl2)"
              title="Vision capable"
            >
              V
            </span>
          ) : null}
          {model.active ? (
            <span
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-(--ok)/15 px-1.5 py-0.5 text-[length:var(--fs-2xs)] text-(--ok)"
              title="Currently running — ready to use without launching"
            >
              <span className="h-1 w-1 rounded-full bg-(--ok)" />
              running
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[length:var(--fs-2xs)] text-(--dim)">
          {formatCompactNumber(model.contextWindow)} ctx
          {model.maxTokens !== model.contextWindow
            ? ` · ${formatCompactNumber(model.maxTokens)} out`
            : ""}
        </span>
      </span>
    </button>
  );
}

function buildFilteredView(
  _models: AgentModel[],
  groups: ModelGroup[],
  query: string,
  currentKey: string | null,
): { flatItems: FlatItem[]; filteredGroups: ModelGroup[] } {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    // No search: show only current tab's models
    const currentGroup = groups.find((group) => group.key === currentKey) ?? groups[0];
    const flat: FlatItem[] = (currentGroup?.models ?? []).map((model, i) => ({
      type: "model" as const,
      model,
      groupIndex: i,
    }));
    return { flatItems: flat, filteredGroups: groups };
  }

  // Searching: show all matching models across all providers, grouped by provider
  const matchingGroups: ModelGroup[] = [];
  for (const group of groups) {
    const matching = group.models.filter((model) => matchesQuery(model, trimmed));
    if (matching.length > 0) {
      matchingGroups.push({ ...group, models: matching });
    }
  }

  const flat: FlatItem[] = [];
  for (const group of matchingGroups) {
    flat.push({ type: "header", label: group.name });
    for (const model of group.models) {
      flat.push({ type: "model", model, groupIndex: flat.length });
    }
  }
  return { flatItems: flat, filteredGroups: matchingGroups };
}

function matchesQuery(model: AgentModel, query: string): boolean {
  const haystack = [model.id, model.rawId, model.name, model.controllerName, model.providerId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

function findNextModelIndex(items: FlatItem[], current: number, direction: 1 | -1): number | null {
  let idx = current;
  for (let i = 0; i < items.length; i++) {
    idx += direction;
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    if (items[idx]?.type === "model") return idx;
  }
  return null;
}

function modelTriggerLabel(
  active: AgentModel | null,
  selectedModel: string,
  loading: boolean,
  modelCount: number,
): string {
  const fallbackLabel = selectedModel || (modelCount === 0 ? "No models" : "model");
  if (loading) return active?.rawId || active?.name || fallbackLabel || "Loading…";
  if (active?.controllerName && active.providerId?.startsWith("user-pi-")) {
    return `${active.rawId || active.name}`;
  }
  return active?.rawId || active?.name || fallbackLabel;
}

function controllerGroupKey(model: AgentModel): string {
  return model.controllerUrl ?? model.controllerName ?? "primary";
}

function groupModelsByController(models: AgentModel[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    const key = controllerGroupKey(model);
    const existing = groups.get(key);
    if (existing) existing.models.push(model);
    else groups.set(key, { key, name: model.controllerName ?? "local", models: [model] });
  }
  return [...groups.values()];
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function subscribeToControllerStorage(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function computeActiveControllerLabel(): string | null {
  if (typeof window === "undefined") return null;
  const url = getStoredBackendUrl();
  if (!url) return null;
  const saved = loadSavedControllers();
  if (saved.length === 0) return null;
  const match = saved.find((entry) => entry.url === url);
  return match?.name?.trim() || shortHost(url);
}

function useActiveControllerLabel(): string | null {
  return useSyncExternalStore(
    subscribeToControllerStorage,
    computeActiveControllerLabel,
    () => null,
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
