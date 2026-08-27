import { Schema } from "effect";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";

export const DEFAULT_AGENT_MODEL_KEY = "local-studio.agent.defaultModel";
export const DEFAULT_AGENT_ROUTE_KEY = "local-studio.agent.defaultRoute";
export const AGENT_DEFAULTS_KEY = "local-studio.agent.defaults.v1";
export const AGENT_DEFAULTS_CHANGED_EVENT = "local-studio:agent-defaults-changed";

const AgentDefaultsSchema = Schema.Struct({
  version: Schema.Literal(1),
  modelId: Schema.String,
  routeId: Schema.String,
  providerId: Schema.String,
  harness: Schema.String,
  providerOrder: Schema.Array(Schema.String),
  harnessOrder: Schema.Array(Schema.String),
  titleModelId: Schema.String,
  titleRouteId: Schema.String,
  autoTitle: Schema.Boolean,
});

export type AgentDefaults = typeof AgentDefaultsSchema.Type;

const FALLBACK_DEFAULTS: AgentDefaults = {
  version: 1,
  modelId: "",
  routeId: "",
  providerId: "",
  harness: "pi",
  providerOrder: [],
  harnessOrder: [],
  titleModelId: "",
  titleRouteId: "",
  autoTitle: true,
};

export function readAgentDefaults(storage: Pick<Storage, "getItem">): AgentDefaults {
  try {
    const raw = storage.getItem(AGENT_DEFAULTS_KEY);
    const decoded = Schema.decodeUnknownOption(AgentDefaultsSchema)(raw ? JSON.parse(raw) : null);
    if (decoded._tag === "Some") return decoded.value;
  } catch {}
  return {
    ...FALLBACK_DEFAULTS,
    modelId: storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "",
    routeId: storage.getItem(DEFAULT_AGENT_ROUTE_KEY)?.trim() ?? "",
  };
}

export function writeAgentDefaults(
  storage: Pick<Storage, "getItem" | "setItem">,
  patch: Partial<Omit<AgentDefaults, "version">>,
): AgentDefaults {
  const next = { ...readAgentDefaults(storage), ...patch, version: 1 } satisfies AgentDefaults;
  storage.setItem(AGENT_DEFAULTS_KEY, JSON.stringify(next));
  storage.setItem(DEFAULT_AGENT_MODEL_KEY, next.modelId);
  storage.setItem(DEFAULT_AGENT_ROUTE_KEY, next.routeId);
  scheduleDurableUiPreferencesSave();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AGENT_DEFAULTS_CHANGED_EVENT));
  return next;
}

export function orderedByPreference<T extends { id: string }>(
  values: readonly T[],
  order: readonly string[],
): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...values].toSorted(
    (left, right) =>
      (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
  );
}

export function readDefaultAgentModel(storage: Pick<Storage, "getItem">): string {
  return storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "";
}

export function readDefaultAgentRoute(storage: Pick<Storage, "getItem">): string {
  return storage.getItem(DEFAULT_AGENT_ROUTE_KEY)?.trim() ?? "";
}

export function writeDefaultAgentModel(
  storage: Pick<Storage, "getItem" | "setItem">,
  modelId: string,
  routeId: string,
): void {
  writeAgentDefaults(storage, { modelId, routeId });
}
