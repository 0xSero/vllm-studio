"use client";

import type { ReactNode } from "react";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import type { LlamacppOption } from "@/features/recipes/llamacpp-options";

function coerceBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return false;
}

/**
 * Renders an engine-native option grid (llama.cpp / MLX) from a declarative
 * option list. Every value is stored verbatim in `extra_args`, so these are the
 * exact flags the engine receives.
 */
export function EngineOptionsSection({
  title,
  icon,
  options,
  helpText,
  getValueForKey,
  setValueForKey,
}: {
  title: string;
  icon: ReactNode;
  options: LlamacppOption[];
  helpText?: string;
  getValueForKey: (key: string) => unknown;
  setValueForKey: (key: string, value: unknown) => void;
}) {
  if (options.length === 0) return null;

  return (
    <FormSection icon={icon} title={title}>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const value = getValueForKey(option.key);
          const wide =
            option.type === "text" &&
            /prompt|template|grammar|control|model|adapter/.test(option.key);
          const span = wide ? "col-span-2" : undefined;

          if (option.type === "boolean") {
            return (
              <CheckboxRow
                key={option.key}
                className={span}
                checked={coerceBooleanValue(value)}
                onChange={(checked) => setValueForKey(option.key, checked ? true : undefined)}
                label={option.label}
                description={option.description}
              />
            );
          }

          if (option.type === "select") {
            return (
              <FormField
                key={option.key}
                label={option.label}
                description={option.description}
                className={span}
              >
                <Select
                  value={value ? String(value) : ""}
                  onChange={(e) => setValueForKey(option.key, e.target.value || undefined)}
                >
                  <option value="">Default</option>
                  {option.options?.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </Select>
              </FormField>
            );
          }

          const inputType = option.type === "number" ? "number" : "text";
          return (
            <FormField
              key={option.key}
              label={option.label}
              description={option.description}
              className={span}
            >
              <Input
                type={inputType}
                value={value !== undefined && value !== null ? String(value) : ""}
                onChange={(e) =>
                  setValueForKey(
                    option.key,
                    inputType === "number"
                      ? e.target.value
                        ? Number(e.target.value)
                        : undefined
                      : e.target.value,
                  )
                }
                placeholder={option.placeholder}
              />
            </FormField>
          );
        })}
      </div>
      {helpText ? <p className="text-xs text-(--ui-muted)">{helpText}</p> : null}
    </FormSection>
  );
}
