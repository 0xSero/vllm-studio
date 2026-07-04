/**
 * Module-level stale-while-revalidate store for page data.
 *
 * Page hooks seed their state from here so client-side navigation paints the
 * last-known data instantly while the fresh fetch runs in the background.
 * Controller round-trips go through a tunnel and can take seconds — without
 * this every route switch stares at a spinner for the full fetch.
 *
 * Plain module memory: survives route switches (same JS context), resets on
 * window reload, never persisted.
 */
const cache = new Map<string, unknown>();

export function readPageCache<T>(key: string): T | null {
  return (cache.get(key) as T | undefined) ?? null;
}

export function writePageCache<T>(key: string, value: T): void {
  cache.set(key, value);
}
