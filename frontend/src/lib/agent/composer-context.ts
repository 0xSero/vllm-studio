export type ComposerPluginRef = {
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  path?: string;
  enabled?: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
  instructions?: string;
};

export type ComposerSkillRef = {
  id: string;
  name: string;
  source?: string;
  path?: string;
  instructions?: string;
};

export type ComposerMention = {
  kind: "plugin" | "skill";
  query: string;
  start: number;
  end: number;
};

export function activeComposerPlugins(plugins: ComposerPluginRef[] = []): ComposerPluginRef[] {
  return plugins.filter((plugin) => plugin.enabled !== false);
}

export function activateComposerPlugin(plugin: ComposerPluginRef): ComposerPluginRef {
  return { ...plugin, enabled: true };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && Boolean(item));
  return strings.length ? strings : undefined;
}

export function sanitizeComposerPlugins(value: unknown): ComposerPluginRef[] {
  if (!Array.isArray(value)) return [];
  return activeComposerPlugins(
    value.flatMap((item): ComposerPluginRef[] => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const plugin: ComposerPluginRef = {
        id: stringField(record, "id") ?? "",
        name: stringField(record, "name") ?? "",
        displayName: stringField(record, "displayName"),
        version: stringField(record, "version"),
        path: stringField(record, "path"),
        enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
        description: stringField(record, "description"),
        shortDescription: stringField(record, "shortDescription"),
        source: stringField(record, "source"),
        category: stringField(record, "category"),
        capabilities: stringArrayField(record, "capabilities"),
        defaultPrompts: stringArrayField(record, "defaultPrompts"),
        brandColor: stringField(record, "brandColor"),
        iconPath: stringField(record, "iconPath"),
        skillPath: stringField(record, "skillPath"),
        mcpConfigPath: stringField(record, "mcpConfigPath"),
        appConfigPath: stringField(record, "appConfigPath"),
        appIds: stringArrayField(record, "appIds"),
        appPath: stringField(record, "appPath"),
        instructions: stringField(record, "instructions"),
      };
      return plugin.name || plugin.id || plugin.path ? [plugin] : [];
    }),
  );
}

export function sanitizeComposerSkills(value: unknown): ComposerSkillRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerSkillRef[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const skill: ComposerSkillRef = {
      id: stringField(record, "id") ?? "",
      name: stringField(record, "name") ?? "",
      source: stringField(record, "source"),
      path: stringField(record, "path"),
      instructions: stringField(record, "instructions"),
    };
    return skill.name || skill.id || skill.path ? [skill] : [];
  });
}

export function detectComposerMention(value: string, caret = value.length): ComposerMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = /(^|\s)([@$])([^\n@$]{0,80})$/.exec(beforeCaret);
  if (!match) return null;
  const token = `${match[2]}${match[3] ?? ""}`;
  return {
    kind: match[2] === "@" ? "plugin" : "skill",
    query: (match[3] ?? "").trimStart(),
    start: safeCaret - token.length,
    end: safeCaret,
  };
}

export function replaceComposerMention(
  value: string,
  mention: ComposerMention,
  label: string,
): string {
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.end);
  const prefix = before && !/\s$/.test(before) ? `${before} ` : before;
  const suffix = after && !/^\s/.test(after) ? ` ${after}` : after;
  return `${prefix}${mention.kind === "plugin" ? "@" : "$"}${label} ${suffix}`.trimStart();
}

export function consumeComposerMention(value: string, mention: ComposerMention): string {
  const before = value.slice(0, mention.start).replace(/[ \t]+$/, "");
  const after = value.slice(mention.end).replace(/^[ \t]+/, "");
  if (!before) return after;
  if (!after) return before;
  return `${before} ${after}`;
}

export function selectedContextPrompt(
  text: string,
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string {
  const lines = selectedContextLines(plugins, skills);
  if (!lines.length) return text;
  return [`Composer context:\n${lines.join("\n")}`, "User prompt:", text].join("\n\n");
}

export function selectedContextInstructions(
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string | undefined {
  const lines = selectedContextLines(plugins, skills);
  if (!lines.length) return undefined;
  return ["Preserve this selected composer context after compaction.", ...lines].join("\n");
}

function selectedContextLines(
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string[] {
  const lines: string[] = [];
  const enabledPlugins = activeComposerPlugins(plugins);
  if (enabledPlugins.length) {
    lines.push(`Enabled plugins: ${enabledPlugins.map(pluginRefLabel).join(", ")}.`);
    for (const plugin of enabledPlugins) {
      const label = pluginRefLabel(plugin);
      const summary = plugin.shortDescription ?? plugin.description;
      if (summary) lines.push(`Plugin ${label}: ${summary}`);
      if (plugin.capabilities?.length) {
        lines.push(`Plugin ${label} capabilities: ${plugin.capabilities.join(", ")}`);
      }
      if (plugin.defaultPrompts?.length) {
        lines.push(
          `Plugin ${label} default prompts: ${plugin.defaultPrompts.slice(0, 2).join(" | ")}`,
        );
      }
      if (plugin.instructions) lines.push(`Plugin ${label} instructions:\n${plugin.instructions}`);
      const runtime = pluginRuntimeDetails(plugin);
      if (runtime.length) {
        lines.push(`Plugin ${label} runtime: ${runtime.join("; ")}`);
      }
      if (plugin.appIds?.length) {
        lines.push(`Plugin ${label} declares app connectors: ${plugin.appIds.join(", ")}`);
      }
    }
    if (enabledPlugins.some((plugin) => pluginNameIncludes(plugin, "browser-use"))) {
      lines.push("Browser-use is enabled; use browser tools when the task requires page control.");
    }
    if (enabledPlugins.some((plugin) => pluginNameIncludes(plugin, "computer-use"))) {
      lines.push(
        "Computer-use is selected; use the vLLM Studio browser tools for browser/webview tasks. Full desktop-control MCP may be unavailable outside a Codex-signed/brokered runtime; do not retry launch-constrained desktop MCP failures forever.",
      );
    }
  }
  if (skills.length) {
    lines.push("Loaded skills:");
    for (const skill of skills) {
      const label = `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`;
      lines.push(skill.instructions ? `${label}\n${skill.instructions}` : label);
    }
  }
  return lines;
}

function pluginRuntimeDetails(plugin: ComposerPluginRef): string[] {
  return [
    plugin.path ? `plugin=${plugin.path}` : null,
    plugin.skillPath ? `skills=${plugin.skillPath}` : null,
    plugin.mcpConfigPath ? `mcp=${plugin.mcpConfigPath}` : null,
    plugin.appConfigPath ? `apps=${plugin.appConfigPath}` : null,
    plugin.appPath ? `app=${plugin.appPath}` : null,
  ].filter((value): value is string => Boolean(value));
}

function pluginRefLabel(plugin: ComposerPluginRef): string {
  return plugin.source ? `@${plugin.name} (${plugin.source})` : `@${plugin.name}`;
}

function pluginNameIncludes(plugin: ComposerPluginRef, needle: string): boolean {
  return [plugin.id, plugin.name, plugin.displayName, plugin.path]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function searchableText(row: {
  name: string;
  displayName?: string;
  source?: string;
  category?: string;
  shortDescription?: string;
}): string[] {
  return [row.name, row.displayName, row.source, row.category, row.shortDescription].filter(
    (value): value is string => Boolean(value),
  );
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

export function byQuery<
  T extends {
    name: string;
    displayName?: string;
    source?: string;
    category?: string;
    shortDescription?: string;
  },
>(rows: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const nq = normalized(q);
  const scored = rows
    .map((row) => {
      const fields = searchableText(row).map((value) => value.toLowerCase());
      const normalizedFields = fields.map(normalized);
      const primary = row.name.toLowerCase();
      const display = row.displayName?.toLowerCase();
      const score = !q
        ? 2
        : primary === q ||
            display === q ||
            normalized(primary) === nq ||
            normalized(display ?? "") === nq
          ? 0
          : primary.startsWith(q) ||
              Boolean(display?.startsWith(q)) ||
              normalized(primary).startsWith(nq) ||
              normalized(display ?? "").startsWith(nq)
            ? 1
            : fields.some((field) => field.includes(q)) ||
                normalizedFields.some((field) => field.includes(nq))
              ? 2
              : 9;
      return { row, score };
    })
    .filter((item) => item.score < 9)
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, limit).map((item) => item.row);
}
