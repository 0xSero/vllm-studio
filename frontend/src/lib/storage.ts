export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;
export type StorageRemover = Pick<Storage, "removeItem">;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(
  key: string,
  storage: StorageReader | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(
  key: string,
  value: string,
  storage: StorageWriter | null = browserStorage(),
): void {
  try {
    storage?.setItem(key, value);
  } catch {}
}

export function removeStored(key: string, storage: StorageRemover | null = browserStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {}
}

export function readStoredJson<T>(
  key: string,
  fallback: T,
  decode: (value: unknown) => T | null,
  storage: StorageReader | null = browserStorage(),
): T {
  try {
    const raw = readStored(key, storage);
    return raw ? (decode(JSON.parse(raw) as unknown) ?? fallback) : fallback;
  } catch {
    return fallback;
  }
}
