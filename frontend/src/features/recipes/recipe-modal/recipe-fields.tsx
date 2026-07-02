"use client";

import { CheckboxRow } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

// Keys of RecipeEditor whose value is a boolean toggle.
type BooleanRecipeField = {
  [K in keyof RecipeEditor]-?: NonNullable<RecipeEditor[K]> extends boolean ? K : never;
}[keyof RecipeEditor];

/**
 * A recipe boolean toggle. Collapses the repeated
 * `checked={recipe.X || false} onChange={c => onChange({ ...recipe, X: c })}`
 * block that every editor checkbox duplicated. `field` is constrained to the
 * recipe's boolean keys, so a typo or a non-boolean field is a type error.
 */
export function RecipeCheckbox({
  recipe,
  onChange,
  field,
  label,
  description,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  field: BooleanRecipeField;
  label: string;
  description?: string;
}) {
  return (
    <CheckboxRow
      checked={recipe[field] || false}
      onChange={(checked) => onChange({ ...recipe, [field]: checked })}
      label={label}
      description={description}
    />
  );
}
