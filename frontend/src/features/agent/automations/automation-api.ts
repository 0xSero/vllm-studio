import { Effect, Schema } from "effect";
import {
  AutomationResponseSchema,
  AutomationsResponseSchema,
  type Automation,
} from "@shared/agent/automation";
import type { AutomationDraft } from "./automation-model";
import { requestJsonEffect } from "@/lib/api/request-json";

const AgentModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

const AgentModelsResponseSchema = Schema.Struct({
  models: Schema.Array(AgentModelSchema),
});

const RunResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  started: Schema.Boolean,
});

const DeleteResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

export type AutomationModel = typeof AgentModelSchema.Type;

const request = <T>(url: string, schema: Schema.ConstraintDecoder<T>, init?: RequestInit) =>
  requestJsonEffect(url, schema, { cache: "no-store", ...init }, "Automation request failed");

export function listAutomations(): Effect.Effect<Automation[], Error> {
  return Effect.map(
    request("/api/agent/automations", AutomationsResponseSchema),
    ({ automations }) => [...automations],
  );
}

export function listAutomationModels(): Effect.Effect<AutomationModel[], Error> {
  return Effect.map(request("/api/agent/models", AgentModelsResponseSchema), ({ models }) => [
    ...models,
  ]);
}

export function createAutomation(draft: AutomationDraft): Effect.Effect<Automation, Error> {
  return Effect.map(
    request("/api/agent/automations", AutomationResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
    ({ automation }) => automation,
  );
}

export function updateAutomation(
  id: string,
  patch: Partial<AutomationDraft> & { status?: Automation["status"]; unread?: boolean },
): Effect.Effect<Automation, Error> {
  return Effect.map(
    request(`/api/agent/automations/${encodeURIComponent(id)}`, AutomationResponseSchema, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    ({ automation }) => automation,
  );
}

export function deleteAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    request(`/api/agent/automations/${encodeURIComponent(id)}`, DeleteResponseSchema, {
      method: "DELETE",
    }),
    ({ ok }) => ok,
  );
}

export function runAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    request(`/api/agent/automations/${encodeURIComponent(id)}/run`, RunResponseSchema, {
      method: "POST",
    }),
    ({ started }) => started,
  );
}
