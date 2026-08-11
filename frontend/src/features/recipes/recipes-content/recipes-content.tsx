"use client";

import { RecipesContentView } from "./recipes-content-view";

export function RecipesContent({ embedded = false }: { embedded?: boolean }) {
  return <RecipesContentView embedded={embedded} />;
}
