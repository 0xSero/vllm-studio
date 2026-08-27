// Composer skill / prompt-template references and their sanitizers, plus the
// "selected context" prompt builders derived from them.
//
// Moved here from frontend/src/features/agent/composer-context.ts so the
// @local-studio/agent-runtime HTTP handlers (turn + compact) can share the
// exact sanitization logic with the frontend; the frontend module re-exports
// everything from this file for its client-side callers.

import { Schema } from "effect";
import { isRecord, type UnknownRecord, type UnparsedValue } from "./guards";

export type ComposerSkillRef = {
  id: string;
  name: string;
  source?: string | undefined;
  path?: string | undefined;
  instructions?: string | undefined;
};

export type ComposerPromptTemplateRef = {
  id: string;
  name: string;
  source?: string | undefined;
  path?: string | undefined;
  description?: string | undefined;
  argumentHint?: string | undefined;
};

const isString = Schema.is(Schema.String);

function stringField(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return isString(value) && value.trim() ? value : undefined;
}

export function sanitizeComposerSkills(value: UnparsedValue): ComposerSkillRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerSkillRef[] => {
    if (!isRecord(item)) return [];
    const skill: ComposerSkillRef = {
      id: stringField(item, "id") ?? "",
      name: stringField(item, "name") ?? "",
      source: stringField(item, "source"),
      path: stringField(item, "path"),
      instructions: stringField(item, "instructions"),
    };
    return skill.name || skill.id || skill.path ? [skill] : [];
  });
}

export function sanitizeComposerPromptTemplates(value: UnparsedValue): ComposerPromptTemplateRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ComposerPromptTemplateRef[] => {
    if (!isRecord(item)) return [];
    const template: ComposerPromptTemplateRef = {
      id: stringField(item, "id") ?? "",
      name: stringField(item, "name") ?? "",
      source: stringField(item, "source"),
      path: stringField(item, "path"),
      description: stringField(item, "description"),
      argumentHint: stringField(item, "argumentHint"),
    };
    return template.name || template.id || template.path ? [template] : [];
  });
}

export function selectedContextPrompt(text: string, skills: ComposerSkillRef[] = []): string {
  const lines = selectedContextLines(skills);
  if (!lines.length) return text;
  return [`Composer context:\n${lines.join("\n")}`, "User prompt:", text].join("\n\n");
}

export function selectedContextInstructions(skills: ComposerSkillRef[] = []): string | undefined {
  const lines = selectedContextLines(skills);
  if (!lines.length) return undefined;
  return ["Preserve this selected composer context after compaction.", ...lines].join("\n");
}

function selectedContextLines(skills: ComposerSkillRef[] = []): string[] {
  return selectedSkillContextLines(skills);
}

function selectedSkillContextLines(skills: ComposerSkillRef[] = []): string[] {
  if (!skills.length) return [];
  return ["Loaded skills:", ...skills.map(skillContextLine)];
}

function skillContextLine(skill: ComposerSkillRef): string {
  const label = `$${skill.name}${skill.path ? ` (${skill.path})` : ""}`;
  return skill.instructions ? `${label}\n${skill.instructions}` : label;
}
