"use client";

import { Effect, Schema } from "effect";
import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "@/features/recipes/recipes-content/model-page";

const ConnectedModelSchema = Schema.Struct({
  id: Schema.String,
  rawId: Schema.String,
  name: Schema.String,
  providerId: Schema.String,
  controllerName: Schema.String,
  contextWindow: Schema.Number,
  reasoning: Schema.Boolean,
  active: Schema.Boolean,
});

const ConnectedModelsResponseSchema = Schema.Struct({
  models: Schema.Array(ConnectedModelSchema),
});

type ConnectedModel = typeof ConnectedModelSchema.Type;

const loadConnectedModels = (): Effect.Effect<ConnectedModel[], Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch("/api/agent/models", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = Schema.decodeUnknownSync(ConnectedModelsResponseSchema)(
        await response.json(),
      );
      return payload.models.filter((model) => model.providerId.startsWith("user-pi-"));
    },
    catch: (error) =>
      error instanceof Error ? error : new Error("Connected model discovery failed"),
  });

export function ConnectedModelsSection() {
  const [models, setModels] = useState<ConnectedModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMountSubscription(() => {
    void Effect.runPromise(loadConnectedModels())
      .then(setModels)
      .catch((failure: Error) => {
        setModels([]);
        setError(failure.message);
      });
  }, []);

  return (
    <ModelSection
      title="Connected models"
      description="Models discovered from configured OpenAI-compatible inference endpoints."
      actions={
        <ModelStatus tone={error ? "warning" : models?.length ? "good" : "default"}>
          {error ? "unavailable" : models === null ? "loading" : `${models.length} available`}
        </ModelStatus>
      }
    >
      {models?.map((model) => (
        <ModelRow
          key={model.id}
          label={model.name}
          description={`${model.controllerName} · ${model.rawId}`}
          value={
            <ModelValue mono>
              {`${Math.round(model.contextWindow / 1000)}k context${model.reasoning ? " · reasoning" : ""}`}
            </ModelValue>
          }
          status={
            <ModelStatus tone={model.active ? "good" : "info"}>
              {model.active ? "active" : "available"}
            </ModelStatus>
          }
        />
      ))}
      {models?.length === 0 ? (
        <div className="px-1 py-5 text-[length:var(--fs-sm)] text-(--ui-muted)">
          {error ?? "No configured inference endpoints reported models."}
        </div>
      ) : null}
    </ModelSection>
  );
}
