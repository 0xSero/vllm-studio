"use client";

import type { ReactNode } from "react";
import { CheckboxRow, FormField, Input, Select } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

type FieldOptions = { description?: string; required?: boolean };
type InputOptions = FieldOptions & {
  type?: "text" | "number";
  placeholder?: string;
  min?: number;
  fallback?: string | number;
  icon?: ReactNode;
  preserveEmpty?: boolean;
};
type SelectOptions = FieldOptions & { fallback?: string; numeric?: boolean; empty?: string };

export function createRecipeFields(recipe: RecipeEditor, onChange: (next: RecipeEditor) => void) {
  const update = (name: keyof RecipeEditor, value: unknown) =>
    onChange({ ...recipe, [name]: value });

  return {
    input(name: keyof RecipeEditor, label: string, options: InputOptions = {}) {
      const { description, required, type = "text", placeholder, min, fallback, icon } = options;
      return (
        <FormField label={label} description={description} required={required}>
          <Input
            type={type}
            min={min}
            value={(recipe[name] as string | number | null | undefined) || fallback || ""}
            onChange={(event) =>
              update(
                name,
                type === "number"
                  ? Number(event.target.value) || undefined
                  : event.target.value || (options.preserveEmpty ? "" : undefined),
              )
            }
            placeholder={placeholder}
            icon={icon}
          />
        </FormField>
      );
    },
    select(
      name: keyof RecipeEditor,
      label: string,
      children: ReactNode,
      options: SelectOptions = {},
    ) {
      const { description, fallback = "", numeric = false, empty = "" } = options;
      return (
        <FormField label={label} description={description}>
          <Select
            value={String(recipe[name] ?? fallback)}
            onChange={(event) =>
              update(
                name,
                event.target.value === empty
                  ? undefined
                  : numeric
                    ? Number(event.target.value) || undefined
                    : event.target.value,
              )
            }
          >
            {children}
          </Select>
        </FormField>
      );
    },
    checkbox(name: keyof RecipeEditor, label: string, description?: string) {
      return (
        <CheckboxRow
          checked={Boolean(recipe[name])}
          onChange={(checked) => update(name, checked)}
          label={label}
          description={description}
        />
      );
    },
  };
}
