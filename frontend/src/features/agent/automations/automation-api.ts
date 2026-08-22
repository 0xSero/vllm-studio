import { Effect, Schema } from "effect";
import {
  AutomationResponseSchema,
  AutomationsResponseSchema,
  type Automation,
} from "@shared/agent/automation";
import type { AutomationDraft } from "./automation-model";

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

const decodeAutomation = Schema.decodeUnknownSync(AutomationResponseSchema);

const automationUrl = (id: string) => `/api/agent/automations/${encodeURIComponent(id)}`;

const jsonBody = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function requestJson<A>(
  input: string,
  decode: (input: unknown) => A,
  init?: RequestInit,
): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(input, { cache: "no-store", ...init });
      if (!response.ok) throw new Error(await errorMessage(response));
      return decode(await response.json());
    },
    catch: (error) => (error instanceof Error ? error : new Error("Automation request failed")),
  });
}

/** Every endpoint that answers with a single automation record. */
function requestAutomation(input: string, init?: RequestInit): Effect.Effect<Automation, Error> {
  return Effect.map(requestJson(input, decodeAutomation, init), ({ automation }) => automation);
}

export function listAutomations(): Effect.Effect<Automation[], Error> {
  return Effect.map(
    requestJson("/api/agent/automations", Schema.decodeUnknownSync(AutomationsResponseSchema)),
    ({ automations }) => [...automations],
  );
}

export function listAutomationModels(): Effect.Effect<AutomationModel[], Error> {
  return Effect.map(
    requestJson("/api/agent/models", Schema.decodeUnknownSync(AgentModelsResponseSchema)),
    ({ models }) => [...models],
  );
}

export function createAutomation(draft: AutomationDraft): Effect.Effect<Automation, Error> {
  return requestAutomation("/api/agent/automations", jsonBody("POST", draft));
}

export function updateAutomation(
  id: string,
  patch: Partial<AutomationDraft> & { status?: Automation["status"]; unread?: boolean },
): Effect.Effect<Automation, Error> {
  return requestAutomation(automationUrl(id), jsonBody("PATCH", patch));
}

/** Forget every recorded run of an automation, keeping the automation itself.
 *  Same PATCH the tab and the agent tools write through, so the cleared history
 *  is gone everywhere at once. */
export function clearAutomationRuns(id: string): Effect.Effect<Automation, Error> {
  return requestAutomation(automationUrl(id), jsonBody("PATCH", { clearRuns: true }));
}

export function deleteAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(automationUrl(id), Schema.decodeUnknownSync(DeleteResponseSchema), {
      method: "DELETE",
    }),
    ({ ok }) => ok,
  );
}

export function runAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(`${automationUrl(id)}/run`, Schema.decodeUnknownSync(RunResponseSchema), {
      method: "POST",
    }),
    ({ started }) => started,
  );
}
