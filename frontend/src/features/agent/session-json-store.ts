import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

function sanitizeSessionId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

export function createSessionScopedJsonStore<T extends { updatedAt: string }>(config: {
  subdir: string;
  legacyFile: string;
  normalize: (input: unknown) => T;
}) {
  const filePath = (sessionId: string | null | undefined): string => {
    const id = sanitizeSessionId(sessionId);
    return id
      ? path.join(resolveDataDir(), config.subdir, `${id}.json`)
      : path.join(resolveDataDir(), config.legacyFile);
  };

  const read = async (sessionId?: string | null): Promise<T> => {
    try {
      return config.normalize(JSON.parse(await readFile(filePath(sessionId), "utf8")));
    } catch {
      return config.normalize(undefined);
    }
  };

  const write = async (
    patch: Partial<Omit<T, "updatedAt">>,
    sessionId?: string | null,
  ): Promise<T> => {
    const current = await read(sessionId);
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const next = config.normalize({
      ...current,
      ...defined,
      updatedAt: new Date().toISOString(),
    });
    const file = filePath(sessionId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  };

  return { read, write };
}
