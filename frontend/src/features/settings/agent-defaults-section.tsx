"use client";

import { Effect, Schema } from "effect";
import { useMemo, useState } from "react";
import { ModelCatalogResponseSchema } from "@local-studio/contracts/model-catalog";
import type { HarnessCatalogEntry } from "@shared/agent/harness-catalog";
import {
  MessagingDefaultSchema,
  type MessagingDefault,
} from "@shared/agent/messaging-default-contract";
import { Select, SegmentedControl } from "@/ui";
import { ArrowUp, ChevronDown } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useHarnessCatalog } from "@/features/agent/ui/use-harness-catalog";
import {
  AGENT_DEFAULTS_CHANGED_EVENT,
  orderedByPreference,
  readAgentDefaults,
  writeAgentDefaults,
  type AgentDefaults,
} from "@/features/agent/workspace/model-preference";
import {
  loadThinkingLevelDefault,
  setThinkingLevelDefault,
} from "@/features/agent/messages/thinking-level-pref";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import { agentModelsFromCatalog, type CatalogAgentModel } from "@/features/agent/models";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import {
  recommendedThreadTitleRoute,
  threadTitleRouteChoices,
} from "@/features/agent/runtime/thread-title-model";
import { SettingsGroup, SettingsRow } from "./settings-ui";

const THINKING_OPTIONS: Array<{ value: AgentThinkingLevel; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
  { value: "off", label: "Off" },
];

function normalizedOrder(ids: readonly string[], preferred: readonly string[]): string[] {
  const known = new Set(ids);
  return [
    ...preferred.filter((id) => known.has(id)),
    ...ids.filter((id) => !preferred.includes(id)),
  ];
}

function PriorityOrder({
  items,
  order,
  onChange,
}: {
  items: readonly { id: string; label: string }[];
  order: readonly string[];
  onChange: (order: string[]) => void;
}) {
  const ordered = orderedByPreference(items, order);
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= ordered.length) return;
    const next = ordered.map((item) => item.id);
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="flex w-64 max-w-full flex-col gap-1">
      {ordered.map((item, index) => (
        <div
          key={item.id}
          className="flex h-7 w-full items-center rounded-[5px] border border-(--ui-separator) bg-(--ui-bg)/45 pl-2 text-[length:var(--fs-xs)] text-(--ui-fg)"
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <button
            type="button"
            aria-label={`Move ${item.label} earlier`}
            disabled={index === 0}
            onClick={() => move(index, -1)}
            className="ml-1 flex h-6 w-6 items-center justify-center text-(--ui-muted) hover:text-(--ui-fg) disabled:opacity-25"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label={`Move ${item.label} later`}
            disabled={index === ordered.length - 1}
            onClick={() => move(index, 1)}
            className="flex h-6 w-6 items-center justify-center text-(--ui-muted) hover:text-(--ui-fg) disabled:opacity-25"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function loadModels(): Effect.Effect<CatalogAgentModel[], unknown> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() =>
      fetch("/api/agent/models", { cache: "no-store" }),
    );
    const payload = yield* Effect.tryPromise(() => response.json());
    if (!response.ok) return yield* Effect.fail(new Error("Failed to load models"));
    return agentModelsFromCatalog(Schema.decodeUnknownSync(ModelCatalogResponseSchema)(payload));
  });
}

const decodeMessagingDefault = Schema.decodeUnknownSync(MessagingDefaultSchema);

function loadMessagingDefault(): Effect.Effect<MessagingDefault, unknown> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() =>
      fetch("/api/agent/messaging/defaults", { cache: "no-store" }),
    );
    const payload = yield* Effect.tryPromise(() => response.json());
    if (!response.ok) return yield* Effect.fail(new Error("Failed to load messaging defaults"));
    return decodeMessagingDefault(payload);
  });
}

function saveMessagingDefault(modelId: string, modelRouteId: string) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() =>
      fetch("/api/agent/messaging/defaults", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId, modelRouteId }),
      }),
    );
    const payload = yield* Effect.tryPromise(() => response.json());
    if (!response.ok) return yield* Effect.fail(new Error("Failed to save messaging defaults"));
    return decodeMessagingDefault(payload);
  });
}

function availableHarnesses(harnesses: readonly HarnessCatalogEntry[]): HarnessCatalogEntry[] {
  return harnesses.filter(
    (harness) => harness.selectable !== false && harness.status === "available",
  );
}

export function AgentDefaultsSection() {
  const harnessCatalog = useHarnessCatalog();
  const [models, setModels] = useState<CatalogAgentModel[]>([]);
  const [defaults, setDefaults] = useState<AgentDefaults>(() =>
    readAgentDefaults({ getItem: () => null }),
  );
  const [thinking, setThinking] = useState<AgentThinkingLevel>("high");
  const [messagingDefault, setMessagingDefault] = useState<MessagingDefault>({
    modelId: "",
    modelRouteId: "",
  });
  useMountSubscription(() => {
    void Effect.runPromise(loadModels().pipe(Effect.catch(() => Effect.succeed([])))).then(
      setModels,
    );
    void Effect.runPromise(
      loadMessagingDefault().pipe(
        Effect.catch(() => Effect.succeed({ modelId: "", modelRouteId: "" })),
      ),
    ).then(setMessagingDefault);
    const sync = () => setDefaults(readAgentDefaults(window.localStorage));
    sync();
    setThinking(loadThinkingLevelDefault() ?? "high");
    window.addEventListener(AGENT_DEFAULTS_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(AGENT_DEFAULTS_CHANGED_EVENT, sync);
    };
  }, []);
  const choices = useMemo(() => threadTitleRouteChoices(models), [models]);
  const harnesses = useMemo(() => availableHarnesses(harnessCatalog), [harnessCatalog]);
  const providerIds = useMemo(
    () => [...new Set(choices.map((choice) => choice.providerId))],
    [choices],
  );
  const providers = providerIds.map((id) => ({
    id,
    label: choices.find((choice) => choice.providerId === id)?.providerLabel ?? id,
  }));
  const providerOrder = normalizedOrder(providerIds, defaults.providerOrder);
  const harnessOrder = normalizedOrder(
    harnesses.map((harness) => harness.id),
    defaults.harnessOrder,
  );
  const recommendedTitle = recommendedThreadTitleRoute(choices);
  const defaultChoice =
    choices.find(
      (choice) => choice.modelId === defaults.modelId && choice.routeId === defaults.routeId,
    ) ?? choices[0];
  const titleChoice =
    choices.find(
      (choice) =>
        choice.modelId === defaults.titleModelId && choice.routeId === defaults.titleRouteId,
    ) ?? recommendedTitle;
  const messagingChoice = choices.find(
    (choice) =>
      choice.modelId === messagingDefault.modelId &&
      choice.routeId === messagingDefault.modelRouteId,
  );
  const update = (patch: Partial<Omit<AgentDefaults, "version">>) =>
    setDefaults(writeAgentDefaults(window.localStorage, patch));

  return (
    <SettingsGroup
      title="New threads"
      description="Defaults used when a new task starts. Existing tasks keep their own choices."
    >
      <SettingsRow
        label="Default model"
        description="The model and route selected for a new task."
        control={
          <AgentModelPicker
            modelsOnly
            models={models}
            selectedModel={defaultChoice?.modelId ?? ""}
            selectedRoute={defaultChoice?.routeId}
            defaultModel={defaultChoice?.modelId}
            loading={models.length === 0}
            onSelect={(modelId, routeId) => {
              const choice = choices.find(
                (candidate) => candidate.modelId === modelId && candidate.routeId === routeId,
              );
              if (choice) {
                update({
                  modelId: choice.modelId,
                  routeId: choice.routeId,
                  providerId: choice.providerId,
                });
              }
            }}
          />
        }
      />
      <SettingsRow
        label="Default provider"
        description="Preferred provider route when the default model offers it."
        control={
          <Select
            compact
            aria-label="Default provider"
            value={defaults.providerId || defaultChoice?.providerId || ""}
            options={providers.map((provider) => ({ value: provider.id, label: provider.label }))}
            onChange={(event) => {
              const providerId = event.target.value;
              const matchingRoute = choices.find(
                (choice) =>
                  choice.modelId === defaultChoice?.modelId && choice.providerId === providerId,
              );
              update({
                providerId,
                ...(matchingRoute ? { routeId: matchingRoute.routeId } : {}),
              });
            }}
          />
        }
      />
      <SettingsRow
        label="Chat bot model"
        description="Default Chat model used by every Telegram and Discord account."
        control={
          <AgentModelPicker
            modelsOnly
            models={models}
            selectedModel={messagingChoice?.modelId ?? ""}
            selectedRoute={messagingChoice?.routeId}
            loading={models.length === 0}
            onSelect={(modelId, routeId) => {
              void Effect.runPromise(
                saveMessagingDefault(modelId, routeId).pipe(
                  Effect.catch(() => Effect.succeed(messagingDefault)),
                ),
              ).then(setMessagingDefault);
            }}
          />
        }
      />
      <SettingsRow
        label="Default harness"
        description="Chat is embedded and remains automatic; choose the coding harness for tasks."
        control={
          <Select
            compact
            aria-label="Default harness"
            value={
              harnesses.some((harness) => harness.id === defaults.harness)
                ? defaults.harness
                : (harnesses[0]?.id ?? "pi")
            }
            options={orderedByPreference(harnesses, harnessOrder).map((harness) => ({
              value: harness.id,
              label: harness.name,
            }))}
            onChange={(event) => update({ harness: event.target.value })}
          />
        }
      />
      <SettingsRow
        label="Default effort"
        description="Initial reasoning level when the selected model supports it."
        control={
          <Select
            compact
            aria-label="Default effort"
            value={thinking}
            options={THINKING_OPTIONS}
            onChange={(event) => {
              const value = event.target.value as AgentThinkingLevel;
              setThinking(value);
              setThinkingLevelDefault(value);
            }}
          />
        }
      />
      <SettingsRow
        label="Provider order"
        description="Priority used when several provider routes can serve a model."
        control={
          <PriorityOrder
            items={providers}
            order={providerOrder}
            onChange={(providerOrder) => update({ providerOrder })}
          />
        }
      />
      <SettingsRow
        label="Harness order"
        description="Order shown in the composer harness picker."
        control={
          <PriorityOrder
            items={harnesses.map((harness) => ({ id: harness.id, label: harness.name }))}
            order={harnessOrder}
            onChange={(harnessOrder) => update({ harnessOrder })}
          />
        }
      />
      <SettingsRow
        label="Automatic thread names"
        description="After the first completed turn, Chat creates a short title in the background."
        control={
          <SegmentedControl
            size="sm"
            value={defaults.autoTitle ? "on" : "off"}
            onChange={(value) => update({ autoTitle: value === "on" })}
            items={[
              { id: "on", label: "On" },
              { id: "off", label: "Off" },
            ]}
          />
        }
      />
      <SettingsRow
        label="Thread naming model"
        description="A smaller route run through the embedded Chat runtime for summaries and titles."
        control={
          <AgentModelPicker
            modelsOnly
            models={models}
            selectedModel={titleChoice?.modelId ?? ""}
            selectedRoute={titleChoice?.routeId}
            defaultModel={recommendedTitle?.modelId}
            loading={models.length === 0}
            onSelect={(modelId, routeId) => {
              const choice = choices.find(
                (candidate) => candidate.modelId === modelId && candidate.routeId === routeId,
              );
              if (choice) update({ titleModelId: choice.modelId, titleRouteId: choice.routeId });
            }}
          />
        }
      />
    </SettingsGroup>
  );
}
