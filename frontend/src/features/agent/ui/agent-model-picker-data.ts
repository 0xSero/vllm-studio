import type {
  CatalogAgentModel as AgentModel,
  ModelLab,
  ModelRouteOffer,
} from "@/features/agent/models";

export type ModelCompany = {
  key: string;
  label: string;
  logo?: string;
};

export type ModelRoute = {
  key: string;
  label: string;
  speed: "standard" | "fast";
  mode: "standard" | "max";
  thinking: boolean;
  contextWindow: number;
  route: ModelRouteOffer;
  model: AgentModel;
};

export type RouteField = "key" | "speed" | "mode" | "thinking" | "contextWindow";

export type ModelChoice = {
  key: string;
  label: string;
  company: ModelCompany;
  model: AgentModel;
  routes: ModelRoute[];
};

export function buildModelChoices(
  models: AgentModel[],
  providerOrder: readonly string[] = [],
): ModelChoice[] {
  const providerPosition = new Map(providerOrder.map((id, index) => [id, index]));
  return models
    .map((model) => ({
      key: model.id,
      label: model.name,
      company: companyFromLab(model.lab),
      model,
      routes: model.routes
        .map((route) => modelRoute(model, route))
        .toSorted(
          (left, right) =>
            (providerPosition.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
              (providerPosition.get(right.key) ?? Number.MAX_SAFE_INTEGER) ||
            left.label.localeCompare(right.label),
        ),
    }))
    .toSorted(
      (left, right) =>
        Number(right.model.available) - Number(left.model.available) ||
        left.label.localeCompare(right.label),
    );
}

export function availableModelCompanies(choices: ModelChoice[]): ModelCompany[] {
  const companies = new Map<string, ModelCompany>();
  for (const choice of choices) companies.set(choice.company.key, choice.company);
  return [...companies.values()].toSorted((left, right) => left.label.localeCompare(right.label));
}

export function activeModelChoice(
  choices: ModelChoice[],
  selectedModel: string,
): ModelChoice | null {
  return choices.find((choice) => choice.model.id === selectedModel) ?? null;
}

export function routeForChoice(
  choice: ModelChoice,
  selectedRoute: ModelRoute | null,
  defaultModel?: string,
  override: Partial<Pick<ModelRoute, RouteField>> = {},
): ModelRoute | null {
  const fallback =
    choice.routes.find((route) => route.route.id === choice.model.defaultRouteId) ??
    choice.routes.find((route) => route.route.active) ??
    choice.routes[0];
  if (!fallback) return null;
  const target = { ...(selectedRoute ?? fallback), ...override };
  const matchingRoutes = choice.routes.filter((route) => routeMatchesOverride(route, override));
  const candidates = matchingRoutes.length > 0 ? matchingRoutes : choice.routes;
  return (
    candidates.toSorted(
      (left, right) =>
        routeScore(right, target, defaultModel) - routeScore(left, target, defaultModel),
    )[0] ?? null
  );
}

function routeMatchesOverride(
  route: ModelRoute,
  override: Partial<Pick<ModelRoute, RouteField>>,
): boolean {
  return (
    (override.key === undefined || route.key === override.key) &&
    (override.speed === undefined || route.speed === override.speed) &&
    (override.mode === undefined || route.mode === override.mode) &&
    (override.thinking === undefined || route.thinking === override.thinking) &&
    (override.contextWindow === undefined || route.contextWindow === override.contextWindow)
  );
}

export function routeValues<T extends RouteField>(
  choice: ModelChoice,
  field: T,
): Array<ModelRoute[T]> {
  const values = new Map<string, ModelRoute[T]>();
  for (const route of choice.routes) {
    const value = route[field];
    if (!values.has(String(value))) values.set(String(value), value);
  }
  return [...values.values()];
}

export function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  return `${Math.round(value / 1000)}K`;
}

export function modelChoiceSearchText(choice: ModelChoice): string {
  return [
    choice.label,
    choice.company.label,
    choice.model.id,
    choice.model.family,
    ...choice.routes.flatMap((route) => [
      route.label,
      route.route.id,
      route.route.rawModelId,
      route.route.controllerName,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function selectedModelRoute(
  models: AgentModel[],
  selectedModel: string,
  selectedRoute?: string,
): ModelRoute | null {
  const model = models.find((candidate) => candidate.id === selectedModel);
  if (!model) return null;
  const choice = buildModelChoices([model])[0];
  if (!choice) return null;
  const route = model.routes.find((candidate) => candidate.id === selectedRoute);
  return route ? modelRoute(model, route) : routeForChoice(choice, null);
}

function companyFromLab(lab: ModelLab): ModelCompany {
  return {
    key: lab.id,
    label: lab.name,
    ...(lab.logo ? { logo: lab.logo } : {}),
  };
}

function modelRoute(model: AgentModel, route: ModelRouteOffer): ModelRoute {
  const variant = parseVariantSlug(route.rawModelId.split("/").at(-1) ?? route.rawModelId);
  return {
    key: route.providerId,
    label: route.label,
    speed: variant.speed,
    mode: variant.mode,
    thinking: variant.thinking,
    contextWindow: route.contextWindow,
    route,
    model,
  };
}

function parseVariantSlug(value: string): {
  speed: ModelRoute["speed"];
  mode: ModelRoute["mode"];
  thinking: boolean;
} {
  const slug = value.toLocaleLowerCase();
  return {
    speed: slug.includes("-fast") ? "fast" : "standard",
    mode: slug.includes("-max") ? "max" : "standard",
    thinking: slug.includes("-thinking"),
  } as const;
}

function routeScore(route: ModelRoute, target: ModelRoute, defaultModel?: string): number {
  return (
    Number(route.route.active) * 128 +
    Number(route.route.id === target.route.id) * 64 +
    Number(route.key === target.key) * 32 +
    Number(route.contextWindow === target.contextWindow) * 16 +
    Number(route.mode === target.mode) * 8 +
    Number(route.thinking === target.thinking) * 4 +
    Number(route.speed === target.speed) * 2 +
    Number(route.model.id === defaultModel)
  );
}
