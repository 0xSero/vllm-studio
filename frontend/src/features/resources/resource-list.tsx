"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ModelButton, SearchInput, type ModelButtonProps } from "@/ui";
import { ResourceLogo } from "@/ui/resource-logo";
import {
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
  type ModelStatusTone,
} from "@/features/recipes/recipes-content/model-page";

export type ResourceRowPresentation = {
  key: string;
  label: string;
  identity?: string;
  company?: string;
  brandColor?: string;
  description: ReactNode;
  value: ReactNode;
  status: ReactNode;
  statusTone?: ModelStatusTone;
  actions?: ReactNode;
  children?: ReactNode;
  onOpen?: () => void;
};

export type ResourceAction = Omit<ModelButtonProps, "children"> & {
  key: string;
  label: ReactNode;
};

type ResourceListProps<T> = {
  title: string;
  description: string;
  items: readonly T[];
  loaded: boolean;
  searchLabel: string;
  searchDescription: string;
  searchPlaceholder: string;
  searchableText: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  row?: (item: T) => ResourceRowPresentation;
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
  row,
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
  const rows = row
    ? visible.map((item) => {
        const view = row(item);
        return (
          <ModelRow
            key={view.key}
            label={view.label}
            description={view.description}
            leading={
              <ResourceLogo
                identity={view.identity ?? view.key}
                label={view.label}
                company={view.company}
                brandColor={view.brandColor}
              />
            }
            value={<ModelValue mono>{view.value}</ModelValue>}
            status={<ModelStatus tone={view.statusTone}>{view.status}</ModelStatus>}
            actions={view.actions}
            onClick={view.onOpen}
          >
            {view.children}
          </ModelRow>
        );
      })
    : visible.map((item) => renderItem?.(item));
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
      {!loaded && loading ? loading : rows}
      {loaded && visible.length === 0 ? (
        <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
          {empty(query, items.length)}
        </div>
      ) : null}
    </ModelSection>
  );
}

export function ResourceRowsSkeleton({ count = 3 }: { count?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="grid animate-pulse gap-3 px-4 py-3 md:grid-cols-2">
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-(--ui-hover)" />
        <div className="h-2.5 w-56 max-w-full rounded bg-(--ui-hover)/70" />
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="h-2.5 w-36 rounded bg-(--ui-hover)/70" />
        <div className="h-5 w-20 rounded-full bg-(--ui-hover)" />
      </div>
    </div>
  ));
}

export function ResourceActions({ actions }: { actions: readonly ResourceAction[] }) {
  return actions.map(({ key, label, ...props }) => (
    <ModelButton key={key} {...props}>
      {label}
    </ModelButton>
  ));
}
