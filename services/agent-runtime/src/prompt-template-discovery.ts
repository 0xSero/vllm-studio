import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveDataDir } from "./data-dir";
import { matchSource, readCapped, sortedRows } from "./discovery-core";

export type PromptTemplateRow = {
  id: string;
  name: string;
  source: string;
  path: string;
  description?: string;
  argumentHint?: string;
};

export type PromptTemplateSource = { source: string; dir: string };

export function defaultPromptTemplateSources(): PromptTemplateSource[] {
  const home = homedir();
  return [
    { source: "local-studio", dir: path.join(resolveDataDir(), "pi-agent", "prompt-templates") },
    { source: "local-studio", dir: path.join(resolveDataDir(), "pi-agent", "prompts") },
    { source: "~/.pi", dir: path.join(home, ".pi", "prompts") },
    { source: "~/.pi", dir: path.join(home, ".pi", "agent", "prompts") },
    { source: "~/.claude", dir: path.join(home, ".claude", "prompts") },
    { source: "~/.codex", dir: path.join(home, ".codex", "prompts") },
  ];
}

function parseFrontMatter(content: string) {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  const result: { name?: string; description?: string; argumentHint?: string } = {};
  if (!match) return result;
  for (const line of match[1].split(/\r?\n/)) {
    const fields = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!fields) continue;
    const key = fields[1].toLowerCase();
    const value = fields[2].trim().replace(/^"|"$/g, "");
    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "argument-hint" || key === "argumenthint") result.argumentHint = value;
  }
  return result;
}

function templateRowFromFile(
  filePath: string,
  source: string,
  defaultName?: string,
): PromptTemplateRow | null {
  if (!filePath.endsWith(".md")) return null;
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const meta = parseFrontMatter(raw);
  const name = meta.name?.trim() || defaultName || path.basename(filePath, ".md");
  return {
    id: `${source}:${name.toLowerCase()}`,
    name,
    source,
    path: filePath,
    description: meta.description,
    argumentHint: meta.argumentHint,
  };
}

export function discoverPromptTemplates(
  sources: PromptTemplateSource[] = defaultPromptTemplateSources(),
): PromptTemplateRow[] {
  const byKey = new Map<string, PromptTemplateRow>();
  for (const { source, dir } of sources) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(dir, entry);
      try {
        if (!statSync(candidate).isFile()) continue;
      } catch {
        continue;
      }
      const row = templateRowFromFile(candidate, source);
      if (row && !byKey.has(row.id)) byKey.set(row.id, row);
    }
  }
  return sortedRows(byKey);
}

export function loadPromptTemplateInstructions(
  templatePath: string,
  sources: PromptTemplateSource[] = defaultPromptTemplateSources(),
  maxChars = 6000,
): (PromptTemplateRow & { instructions: string }) | null {
  const resolved = path.resolve(templatePath);
  const match = matchSource(resolved, sources);
  if (!match) return null;
  const row = templateRowFromFile(resolved, match.source);
  if (!row) return null;
  const instructions = readCapped(resolved, maxChars);
  return instructions === null ? null : { ...row, instructions };
}
