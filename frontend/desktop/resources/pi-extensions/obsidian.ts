import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { Type } from "typebox";
import { decodeJson, present, type Json } from "./first-party-tool.ts";

const VaultSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  open: Schema.Boolean,
  lastOpened: Schema.NullOr(Schema.String),
});
const VaultListSchema = Schema.Array(VaultSchema);
const ConfigVaultSchema = Schema.Struct({
  path: Schema.String,
  ts: Schema.optional(Schema.Number),
  open: Schema.optional(Schema.Boolean),
});
const ConfigSchema = Schema.Struct({ vaults: Schema.Record(Schema.String, ConfigVaultSchema) });
type Vault = typeof VaultSchema.Type;
type NoteFile = { rel: string; abs: string; name: string; modified: string; bytes: number };
type OpenVault = { vault: Vault; root: string };
const MAX_NOTES = 5_000;
const MAX_NOTE_BYTES = 512 * 1024;
const MAX_BODY_CHARS = 100_000;

function configPath(): string {
  const override = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG?.trim();
  if (override) return override;
  const home = homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(home, "AppData", "Roaming"),
      "obsidian",
      "obsidian.json",
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"),
    "obsidian",
    "obsidian.json",
  );
}

function configVaults(): Vault[] {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    const config = Schema.decodeUnknownSync(ConfigSchema)(raw);
    return Object.values(config.vaults).map((entry) => ({
      path: entry.path,
      name: path.basename(entry.path),
      open: entry.open === true,
      lastOpened: entry.ts === undefined ? null : new Date(entry.ts).toISOString(),
    }));
  } catch {
    return [];
  }
}

function readVaults(): Vault[] {
  const injected = process.env.LOCAL_STUDIO_OBSIDIAN_VAULTS?.trim();
  if (injected) {
    try {
      const vaults = Schema.decodeUnknownSync(VaultListSchema)(JSON.parse(injected));
      if (vaults.length > 0) return [...vaults];
    } catch {}
  }
  return configVaults().sort((left, right) => {
    if (left.open !== right.open) return left.open ? -1 : 1;
    return (right.lastOpened ?? "").localeCompare(left.lastOpened ?? "");
  });
}

function selectVault(vaults: Vault[], requested: string | undefined): Vault {
  if (vaults.length === 0) throw new Error(`No Obsidian vault found in ${configPath()}.`);
  const wanted = requested?.trim();
  if (!wanted) return vaults[0];
  const exact = vaults.find((vault) => path.resolve(vault.path) === path.resolve(wanted));
  if (exact) return exact;
  const named = vaults.filter((vault) => vault.name.toLowerCase() === wanted.toLowerCase());
  if (named.length === 1) return named[0];
  throw new Error(`Vault "${wanted}" is missing or ambiguous. Use obsidian_vaults for full paths.`);
}

async function openVault(vaults: Vault[], requested: string | undefined): Promise<OpenVault> {
  const vault = selectVault(vaults, requested);
  return { vault, root: await realpath(vault.path) };
}

function relativeNote(input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const withExtension = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
  const normalized = path.normalize(withExtension);
  const segments = normalized.split(path.sep);
  if (
    !trimmed ||
    path.isAbsolute(normalized) ||
    segments.includes("..") ||
    segments[0] === ".obsidian"
  ) {
    throw new Error("Note path must stay inside the vault and outside .obsidian.");
  }
  return normalized;
}

function ensureInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Note path escapes the vault.");
  }
}

async function existingNote(root: string, input: string): Promise<string> {
  const target = await realpath(path.resolve(root, relativeNote(input)));
  ensureInside(root, target);
  const info = await stat(target);
  if (!info.isFile() || info.size > MAX_NOTE_BYTES)
    throw new Error("Note is missing or too large.");
  return target;
}

async function listNotes(root: string): Promise<{ notes: NoteFile[]; truncated: boolean }> {
  const notes: NoteFile[] = [];
  const queue = [root];
  while (queue.length > 0 && notes.length < MAX_NOTES) {
    const directory = queue.shift();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === ".obsidian" || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(absolute);
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > MAX_NOTE_BYTES) continue;
      notes.push({
        rel: path.relative(root, absolute),
        abs: absolute,
        name: path.basename(entry.name, ".md"),
        modified: info.mtime.toISOString(),
        bytes: info.size,
      });
      if (notes.length >= MAX_NOTES) break;
    }
  }
  return { notes, truncated: queue.length > 0 };
}

async function resolveNote(root: string, input: string): Promise<NoteFile> {
  const notes = (await listNotes(root)).notes;
  const requested = input.trim().replaceAll("\\", "/").replace(/\.md$/i, "").toLowerCase();
  const matches = notes.filter((note) => {
    const relative = note.rel.replaceAll("\\", "/").replace(/\.md$/i, "").toLowerCase();
    return relative === requested || note.name.toLowerCase() === requested;
  });
  if (matches.length !== 1) throw new Error(`Note "${input}" is missing or ambiguous.`);
  return matches[0];
}

type ParsedNote = { metadata: string | null; body: string };
function frontmatter(text: string): ParsedNote {
  if (!text.startsWith("---\n")) return { metadata: null, body: text };
  const end = text.indexOf("\n---\n", 4);
  return end < 0
    ? { metadata: null, body: text }
    : { metadata: text.slice(4, end), body: text.slice(end + 5) };
}

function links(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function excerpt(text: string, query: string): string {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + query.length + 80));
}

async function vaultList(vaults: Vault[]): Promise<Json> {
  const values = await Promise.all(
    vaults.map(async (vault) => {
      const root = await realpath(vault.path);
      const listed = await listNotes(root);
      return { ...vault, notes: listed.notes.length, truncated: listed.truncated };
    }),
  );
  return decodeJson({ vaults: values, config: configPath() });
}

async function searchVault(
  vaults: Vault[],
  query: string,
  requested: string | undefined,
  folder: string | undefined,
  limit: number | undefined,
): Promise<Json> {
  const opened = await openVault(vaults, requested);
  const listed = await listNotes(opened.root);
  const normalizedFolder = folder?.trim().toLowerCase();
  const matches = [];
  for (const note of listed.notes) {
    if (normalizedFolder && !note.rel.toLowerCase().startsWith(normalizedFolder)) continue;
    const text = await readFile(note.abs, "utf8");
    const passage = excerpt(text, query);
    if (!note.name.toLowerCase().includes(query.toLowerCase()) && !passage) continue;
    matches.push({ path: note.rel, title: note.name, modified: note.modified, excerpt: passage });
  }
  const maximum = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.trunc(Number(limit))))
    : 20;
  return decodeJson({
    vault: opened.vault.name,
    query,
    scanned: listed.notes.length,
    truncated: listed.truncated,
    matches: matches.slice(0, maximum),
  });
}

async function readNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  requestedNote: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const note = await resolveNote(opened.root, requestedNote);
  const target = await existingNote(opened.root, note.rel);
  const parsed = frontmatter(await readFile(target, "utf8"));
  return decodeJson({
    vault: opened.vault.name,
    path: note.rel,
    title: note.name,
    modified: note.modified,
    frontmatter: parsed.metadata,
    links: links(parsed.body),
    body: parsed.body.slice(0, MAX_BODY_CHARS),
    truncated: parsed.body.length > MAX_BODY_CHARS,
  });
}

async function recentNotes(
  vaults: Vault[],
  requested: string | undefined,
  limit: number | undefined,
): Promise<Json> {
  const opened = await openVault(vaults, requested);
  const listed = await listNotes(opened.root);
  const maximum = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.trunc(Number(limit))))
    : 20;
  const notes = [...listed.notes]
    .sort((left, right) => right.modified.localeCompare(left.modified))
    .slice(0, maximum);
  return decodeJson({ vault: opened.vault.name, notes, truncated: listed.truncated });
}

async function backlinks(
  vaults: Vault[],
  requestedVault: string | undefined,
  requestedNote: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const target = await resolveNote(opened.root, requestedNote);
  const listed = await listNotes(opened.root);
  const matches = [];
  for (const note of listed.notes) {
    const body = await readFile(note.abs, "utf8");
    if (links(body).some((link) => link.toLowerCase() === target.name.toLowerCase())) {
      matches.push({
        path: note.rel,
        title: note.name,
        excerpt: excerpt(body, `[[${target.name}`),
      });
    }
  }
  return decodeJson({
    vault: opened.vault.name,
    note: target.rel,
    backlinks: matches,
    truncated: listed.truncated,
  });
}

async function createNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  note: string,
  content: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const relative = relativeNote(note);
  const target = path.resolve(opened.root, relative);
  ensureInside(opened.root, target);
  await mkdir(path.dirname(target), { recursive: true });
  ensureInside(opened.root, await realpath(path.dirname(target)));
  await writeFile(target, content, { encoding: "utf8", flag: "wx" });
  return decodeJson({ vault: opened.vault.name, path: relative, created: true });
}

async function appendNote(
  vaults: Vault[],
  requestedVault: string | undefined,
  note: string,
  content: string,
): Promise<Json> {
  const opened = await openVault(vaults, requestedVault);
  const target = await existingNote(opened.root, note);
  await appendFile(target, content, "utf8");
  return decodeJson({
    vault: opened.vault.name,
    path: path.relative(opened.root, target),
    appended: true,
  });
}

export default function registerObsidianExtension(pi: ExtensionAPI): void {
  const vaults = readVaults();
  const vault = Type.Optional(Type.String({ description: "Vault name or full path" }));
  const note = Type.String({ description: "Vault-relative path or unique note name" });
  pi.registerTool({
    name: "obsidian_vaults",
    label: "Obsidian: Vaults",
    description: "List configured vaults and note counts.",
    parameters: Type.Object({}),
    execute: () => present("obsidian", "obsidian_vaults", vaultList(vaults)),
  });
  pi.registerTool({
    name: "obsidian_search",
    label: "Obsidian: Search",
    description: "Search note titles and content without reading .obsidian configuration.",
    parameters: Type.Object({
      query: Type.String(),
      vault,
      scope: Type.Optional(Type.String()),
      folder: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_search",
        searchVault(vaults, params.query.trim(), params.vault, params.folder, params.limit),
      ),
  });
  pi.registerTool({
    name: "obsidian_read",
    label: "Obsidian: Read Note",
    description: "Read one note with frontmatter and wikilinks separated from its body.",
    parameters: Type.Object({ note, vault }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_read", readNote(vaults, params.vault, params.note)),
  });
  pi.registerTool({
    name: "obsidian_recent",
    label: "Obsidian: Recent Notes",
    description: "List recently modified notes.",
    parameters: Type.Object({
      vault,
      limit: Type.Optional(Type.Number()),
      folder: Type.Optional(Type.String()),
    }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_recent", recentNotes(vaults, params.vault, params.limit)),
  });
  pi.registerTool({
    name: "obsidian_backlinks",
    label: "Obsidian: Backlinks",
    description: "Find notes whose wikilinks resolve to one note.",
    parameters: Type.Object({ note, vault }),
    execute: (_id, params) =>
      present("obsidian", "obsidian_backlinks", backlinks(vaults, params.vault, params.note)),
  });
  pi.registerTool({
    name: "obsidian_create",
    label: "Obsidian: Create Note",
    description: "Create a new note without overwriting any existing file.",
    parameters: Type.Object({ note, vault, content: Type.String() }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_create",
        createNote(vaults, params.vault, params.note, params.content),
      ),
  });
  pi.registerTool({
    name: "obsidian_append",
    label: "Obsidian: Append Note",
    description: "Append to an existing note. This never creates or overwrites a note.",
    parameters: Type.Object({ note, vault, content: Type.String() }),
    execute: (_id, params) =>
      present(
        "obsidian",
        "obsidian_append",
        appendNote(vaults, params.vault, params.note, params.content),
      ),
  });
}
