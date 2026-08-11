"use client";

import { useMemo, useState, type ReactNode } from "react";
import { SearchInput } from "@/ui";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  type ModelStatusTone,
} from "@/features/recipes/recipes-content/model-page";

type ResourceListProps<T> = {
  title: string;
  description: string;
  items: readonly T[];
  loaded: boolean;
  searchLabel: string;
  searchDescription: string;
  searchPlaceholder: string;
  searchableText: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  empty: (query: string, total: number) => ReactNode;
  summary?: (visible: number, total: number, loaded: boolean) => ReactNode;
  summaryTone?: (visible: number, total: number, loaded: boolean) => ModelStatusTone;
  searchStatus?: (visible: number) => ReactNode;
  loading?: ReactNode;
  include?: (item: T) => boolean;
  sort?: (left: T, right: T) => number;
  query?: string;
  onQueryChange?: (query: string) => void;
};

export function ResourceList<T>({
  title,
  description,
  items,
  loaded,
  searchLabel,
  searchDescription,
  searchPlaceholder,
  searchableText,
  renderItem,
  empty,
  summary = (visible, total, ready) => (ready ? `${visible} of ${total}` : "discovering"),
  summaryTone = (_visible, _total, ready) => (ready ? "good" : "default"),
  searchStatus = (visible) => visible,
  loading,
  include,
  sort,
  query: controlledQuery,
  onQueryChange,
}: ResourceListProps<T>) {
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const setQuery = onQueryChange ?? setLocalQuery;
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = items.filter(
      (item) =>
        (!include || include(item)) &&
        (!normalized || searchableText(item).toLowerCase().includes(normalized)),
    );
    return sort ? [...filtered].sort(sort) : filtered;
  }, [include, items, query, searchableText, sort]);
  return (
    <ModelSection
      title={title}
      description={description}
      actions={
        <ModelStatus tone={summaryTone(visible.length, items.length, loaded)}>
          {summary(visible.length, items.length, loaded)}
        </ModelStatus>
      }
    >
      <ModelRow
        label={searchLabel}
        description={searchDescription}
        control={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={searchPlaceholder}
            className="w-full"
          />
        }
        status={<ModelStatus>{searchStatus(visible.length)}</ModelStatus>}
      />
      {!loaded && loading ? loading : visible.map(renderItem)}
      {loaded && visible.length === 0 ? (
        <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
          {empty(query, items.length)}
        </div>
      ) : null}
    </ModelSection>
  );
}
