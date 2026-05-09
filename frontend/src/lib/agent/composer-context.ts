export type ComposerPluginRef = {
  id: string;
  name: string;
  path?: string;
  enabled?: boolean;
};

export type ComposerSkillRef = {
  id: string;
  name: string;
  source?: string;
  path?: string;
};

export type ComposerMention = {
  kind: "plugin" | "skill";
  query: string;
  start: number;
  end: number;
};

export function detectComposerMention(value: string, caret = value.length): ComposerMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = /(^|\s)([@$])([^\s@$]*)$/.exec(beforeCaret);
  if (!match) return null;
  const token = `${match[2]}${match[3] ?? ""}`;
  return {
    kind: match[2] === "@" ? "plugin" : "skill",
    query: match[3] ?? "",
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

export function selectedContextPrompt(
  text: string,
  plugins: ComposerPluginRef[] = [],
  skills: ComposerSkillRef[] = [],
): string {
  const lines: string[] = [];
  if (plugins.length) {
    lines.push(`Enabled plugins: ${plugins.map((plugin) => `@${plugin.name}`).join(", ")}.`);
    if (plugins.some((plugin) => plugin.name.includes("browser-use"))) {
      lines.push("Browser-use is enabled; use browser tools when the task requires page control.");
    }
    if (plugins.some((plugin) => plugin.name.includes("computer-use"))) {
      lines.push(
        "Computer-use is available locally; use it only when desktop control is required.",
      );
    }
  }
  if (skills.length) {
    lines.push(
      `Loaded skills: ${skills
        .map((skill) => `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`)
        .join(", ")}.`,
    );
  }
  if (!lines.length) return text;
  return [`Composer context:\n${lines.join("\n")}`, "User prompt:", text].join("\n\n");
}

export function byQuery<T extends { name: string }>(rows: T[], query: string, limit = 8): T[] {
  const q = query.trim().toLowerCase();
  const scored = rows
    .map((row) => {
      const name = row.name.toLowerCase();
      const score = !q ? 2 : name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 9;
      return { row, score };
    })
    .filter((item) => item.score < 9)
    .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, limit).map((item) => item.row);
}
