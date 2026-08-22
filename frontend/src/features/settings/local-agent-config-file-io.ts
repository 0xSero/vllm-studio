/**
 * Generic read/write primitives for the JSON/YAML config files local coding
 * agents keep on disk — shared by the per-agent detection and merge logic in
 * this feature, with no knowledge of any specific agent's schema.
 */
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { isRecord } from "@/lib/guards";

export type JsonRecord = Record<string, unknown>;

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

export const sameBaseUrl = (a: unknown, b: string): boolean =>
  typeof a === "string" && normalizeBaseUrl(a) === normalizeBaseUrl(b);

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** A missing file is not an error here — it just means there is nothing to merge into. */
async function readTextFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}

const parseFailure = (file: string, syntax: string, error: unknown) =>
  `${file} is not valid ${syntax} (${error instanceof Error ? error.message : String(error)}); ` +
  "refusing to modify it";

export async function readJsonFile(
  file: string,
): Promise<{ exists: boolean; config?: JsonRecord; error?: string }> {
  const raw = await readTextFile(file);
  if (raw === null) return { exists: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { exists: true, error: `${file} does not contain a JSON object` };
    }
    return { exists: true, config: parsed };
  } catch (error) {
    return { exists: true, error: parseFailure(file, "JSON", error) };
  }
}

export async function readYamlFile(
  file: string,
): Promise<{ exists: boolean; document?: YAML.Document; error?: string }> {
  const raw = await readTextFile(file);
  if (raw === null) return { exists: false };
  try {
    return { exists: true, document: YAML.parseDocument(raw) };
  } catch (error) {
    return { exists: true, error: parseFailure(file, "YAML", error) };
  }
}

function backupTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export async function backupExistingFile(file: string): Promise<string> {
  const base = `${file}.bak-local-studio-${backupTimestamp(new Date())}`;
  let backupPath = base;
  let suffix = 2;
  while (await pathExists(backupPath)) {
    backupPath = `${base}-${suffix}`;
    suffix += 1;
  }
  await copyFile(file, backupPath);
  return backupPath;
}

async function writeAtomic(file: string, text: string, mode: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tmp, text, { encoding: "utf-8", mode });
  // writeFile's mode is subject to the process umask; chmod makes it exact.
  await chmod(tmp, mode);
  await rename(tmp, file);
}

export const writeJsonAtomic = (file: string, config: JsonRecord, mode: number): Promise<void> =>
  writeAtomic(file, `${JSON.stringify(config, null, 2)}\n`, mode);

export const writeYamlAtomic = (file: string, config: JsonRecord, mode: number): Promise<void> =>
  writeAtomic(file, YAML.stringify(config, { indent: 2, lineWidth: 0 }), mode);

export async function existingFileMode(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mode & 0o777;
  } catch {
    return null;
  }
}
