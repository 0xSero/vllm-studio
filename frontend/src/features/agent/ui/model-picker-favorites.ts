const MODEL_FAVORITES_KEY = "local-studio:model-favorites";

export function readModelFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(MODEL_FAVORITES_KEY) ?? "[]");
    return Array.isArray(stored)
      ? new Set(stored.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function writeModelFavorites(favorites: ReadonlySet<string>): void {
  window.localStorage.setItem(MODEL_FAVORITES_KEY, JSON.stringify([...favorites]));
}

export function hasModelFavorites(): boolean {
  return readModelFavorites().size > 0;
}
