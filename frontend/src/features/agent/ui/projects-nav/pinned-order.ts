import { readStoredJson, writeStored } from "@/lib/storage";

export type PinnedOrderEntry = {
  id: string;
  identities: readonly string[];
};

const PINNED_SESSION_ORDER_KEY = "local-studio.agent.pinned-session-order.v1";

function entryPosition(entry: PinnedOrderEntry, positions: ReadonlyMap<string, number>): number {
  return [entry.id, ...entry.identities].reduce(
    (best, identity) => Math.min(best, positions.get(identity) ?? Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
}

export function orderPinnedEntries<T extends PinnedOrderEntry>(
  entries: readonly T[],
  order: readonly string[],
): T[] {
  const positions = new Map(order.map((id, index) => [id, index] as const));
  return entries
    .map((entry, index) => ({ entry, index, position: entryPosition(entry, positions) }))
    .sort((left, right) => left.position - right.position || left.index - right.index)
    .map(({ entry }) => entry);
}

export function movePinnedEntryBefore<T extends PinnedOrderEntry>(
  entries: readonly T[],
  order: readonly string[],
  draggedId: string,
  targetId: string | null,
): string[] {
  const ids = orderPinnedEntries(entries, order)
    .map((entry) => entry.id)
    .filter((id) => id !== draggedId);
  const targetIndex = targetId ? ids.indexOf(targetId) : -1;
  ids.splice(targetIndex < 0 ? ids.length : targetIndex, 0, draggedId);
  return [...new Set(ids)];
}

export function readPinnedSessionOrder(): string[] {
  return readStoredJson(PINNED_SESSION_ORDER_KEY, [], (value) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : null,
  );
}

export function writePinnedSessionOrder(order: readonly string[]): void {
  writeStored(PINNED_SESSION_ORDER_KEY, JSON.stringify([...order]));
}
