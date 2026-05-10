import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type CodexMarketplace = {
  name: string;
  source?: string;
  sourceType?: string;
  lastUpdated?: string;
};

export function defaultCodexConfigPath() {
  return path.join(homedir(), ".codex", "config.toml");
}

export function pluginConfigKey(name: string, source?: string) {
  const cleanName = name.trim();
  const cleanSource = source?.trim();
  return cleanSource ? `${cleanName}@${cleanSource}` : cleanName;
}

export function setPluginEnabledInConfig(
  rawConfig: string,
  key: string,
  enabled: boolean,
): string {
  const header = `[plugins."${escapeTomlKey(key)}"]`;
  const enabledLine = `enabled = ${enabled ? "true" : "false"}`;
  const sectionStart = rawConfig.indexOf(header);
  if (sectionStart === -1) {
    const prefix = rawConfig.trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}${header}\n${enabledLine}\n`;
  }

  const tailStart = sectionStart + header.length;
  const nextSection = rawConfig.slice(tailStart).search(/\n\[/);
  const sectionEnd =
    nextSection === -1 ? rawConfig.length : tailStart + nextSection;
  const before = rawConfig.slice(0, sectionStart);
  const section = rawConfig.slice(sectionStart, sectionEnd);
  const after = rawConfig.slice(sectionEnd);

  if (/^\s*enabled\s*=\s*(true|false)\s*$/m.test(section)) {
    return before + section.replace(/^\s*enabled\s*=\s*(true|false)\s*$/m, enabledLine) + after;
  }
  return before + `${section.trimEnd()}\n${enabledLine}\n` + after;
}

export function readCodexMarketplaces(configPath = defaultCodexConfigPath()): CodexMarketplace[] {
  const raw = safeRead(configPath);
  const rows: CodexMarketplace[] = [];
  let current: CodexMarketplace | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const header = /^\[marketplaces\.([^\]]+)\]\s*$/.exec(line);
    if (header) {
      current = { name: header[1].replaceAll('"', "") };
      rows.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\[/.test(line)) {
      current = null;
      continue;
    }
    const value = /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (!value) continue;
    if (value[1] === "source") current.source = value[2];
    if (value[1] === "source_type") current.sourceType = value[2];
    if (value[1] === "last_updated") current.lastUpdated = value[2];
  }
  return rows;
}

export function upgradeCodexMarketplace(name?: string, timeoutMs = 120_000) {
  return runCodexPluginCommand(
    ["plugin", "marketplace", "upgrade", ...(name?.trim() ? [name.trim()] : [])],
    timeoutMs,
  );
}

export function addCodexMarketplace(source: string, timeoutMs = 120_000) {
  return runCodexPluginCommand(["plugin", "marketplace", "add", source.trim()], timeoutMs);
}

export function setCodexPluginEnabled({
  name,
  source,
  enabled,
  configPath = defaultCodexConfigPath(),
}: {
  name: string;
  source?: string;
  enabled: boolean;
  configPath?: string;
}) {
  const key = pluginConfigKey(name, source);
  const current = safeRead(configPath);
  const next = setPluginEnabledInConfig(current, key, enabled);
  if (next === current) return { key, changed: false };
  mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, configPath);
  return { key, changed: true };
}

function escapeTomlKey(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function safeRead(filePath: string) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function runCodexPluginCommand(args: string[], timeoutMs: number) {
  const command = process.env.CODEX_BIN || "codex";
  return new Promise<{ ok: boolean; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = 20_000;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nTimed out after ${timeoutMs}ms.`;
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-limit);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-limit);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr || error.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}
