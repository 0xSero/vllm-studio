"use client";

import { Settings } from "lucide-react";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import { LLAMACPP_OPTIONS } from "@/features/recipes/llamacpp-options";

type LlamacppTab = "model" | "resources" | "performance" | "features";

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

export function LlamacppOptionsSection({
  tab,
  getValueForKey,
  setValueForKey,
}: {
  tab: LlamacppTab;
  getValueForKey: (key: string) => unknown;
  setValueForKey: (key: string, value: unknown) => void;
}) {
  const options = LLAMACPP_OPTIONS.filter((option) => option.tab === tab);
  if (options.length === 0) {
    return null;
  }

  return (
    <FormSection icon={<Settings className="h-4 w-4" />} title="llama.cpp Options">
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const value = getValueForKey(option.key);
          const wide =
            option.type === "text" && /prompt|template|grammar|control|model/.test(option.key);
          const span = wide ? "col-span-2" : undefined;

          if (option.type === "boolean") {
            return (
              <CheckboxRow
                key={option.key}
                className={span}
                checked={coerceBooleanValue(value)}
                onChange={(checked) => setValueForKey(option.key, checked ? true : undefined)}
                label={option.label}
              />
            );
          }

          if (option.type === "select") {
            return (
              <FormField key={option.key} label={option.label} className={span}>
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
            <FormField key={option.key} label={option.label} className={span}>
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
      <p className="text-xs text-(--ui-muted)">
        All llama.cpp flags are supported via Extra CLI Arguments. These fields cover the most-used
        options.
      </p>
    </FormSection>
  );
}
