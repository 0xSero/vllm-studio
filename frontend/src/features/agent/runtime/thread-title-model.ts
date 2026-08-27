import type { ModelOffer } from "@local-studio/contracts/model-catalog";

export type ThreadTitleRoute = {
  key: string;
  modelId: string;
  routeId: string;
  providerId: string;
  providerLabel: string;
  label: string;
  model: ModelOffer;
};

const routeKey = (modelId: string, routeId: string) =>
  `${encodeURIComponent(modelId)}::${encodeURIComponent(routeId)}`;

export function threadTitleRouteChoices(models: readonly ModelOffer[]): ThreadTitleRoute[] {
  return models
    .flatMap((model) =>
      model.routes
        .filter((route) => route.status === "ready")
        .map((route) => ({
          key: routeKey(model.id, route.id),
          modelId: model.id,
          routeId: route.id,
          providerId: route.providerId,
          providerLabel: route.label,
          label: `${model.name} · ${route.label}`,
          model,
        })),
    )
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function recommendedThreadTitleRoute(
  choices: readonly ThreadTitleRoute[],
): ThreadTitleRoute | null {
  const compact = choices.filter((choice) =>
    /(?:mini|nano|small|flash|haiku|lite)/i.test(
      `${choice.model.name} ${choice.model.family} ${choice.model.id}`,
    ),
  );
  return (
    (compact.length ? compact : [...choices]).toSorted(
      (left, right) =>
        left.model.maxOutputTokens - right.model.maxOutputTokens ||
        left.model.contextWindow - right.model.contextWindow ||
        left.label.localeCompare(right.label),
    )[0] ?? null
  );
}
