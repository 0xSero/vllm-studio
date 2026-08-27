export type PinnedOrderEntry = {
  id: string;
  identities: readonly string[];
};

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
