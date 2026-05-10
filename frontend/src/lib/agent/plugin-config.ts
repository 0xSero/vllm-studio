import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

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
