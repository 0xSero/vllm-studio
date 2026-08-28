"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import api from "@/lib/api/client";
import type {
  RegistryIndexRow,
  RegistryRecord,
  RegistryRecommendations,
} from "@/lib/api/registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useRegistryRecommendations() {
  const [data, setData] = useState<RegistryRecommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      const result = await api.getRegistryRecommendations({ all });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The model registry could not be reached");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    void load(showAll);
  }, [load, showAll]);

  const refresh = useCallback(() => load(showAll), [load, showAll]);
  const toggleAll = useCallback(() => setShowAll((value) => !value), []);

  return { data, loading, error, refresh, showAll, toggleAll };
}

/**
 * Progressive record loading: the recommendations payload only carries summary
 * rows, so exact records are fetched the first time something asks for them
 * and then kept in one shared cache for the page.
 */
export function useRegistryRecords() {
  const [records, setRecords] = useState<Map<string, RegistryRecord | "error">>(new Map());
  const pending = useRef(new Set<string>());

  const load = useCallback((collection: string, id: string) => {
    const key = `${collection}/${id}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    void api
      .getRegistryRecord(collection, id)
      .then((response) => {
        setRecords((current) => new Map(current).set(key, response.data));
      })
      .catch(() => {
        setRecords((current) => new Map(current).set(key, "error"));
      })
      .finally(() => {
        pending.current.delete(key);
      });
  }, []);

  const recordFor = useCallback(
    (collection: string, id: string): RegistryRecord | "error" | null => {
      const key = `${collection}/${id}`;
      const value = records.get(key);
      if (value === undefined) {
        load(collection, id);
        return null;
      }
      return value;
    },
    [records, load],
  );

  return { recordFor };
}

export interface RegistryFit {
  state: "match" | "other";
  hardware_match: RegistryRecommendations["matches"][number] | null;
}

type LoadedRecord = RegistryRecord | "error" | null;

/** One hydrated registry config: summary row plus its exact records. */
export interface HydratedRegistryRow {
  row: RegistryIndexRow;
  fit: RegistryFit;
  hardware: LoadedRecord;
  instance: LoadedRecord;
  model: LoadedRecord;
  recipe: LoadedRecord;
}

export function useHydratedRegistryRows(rows: RegistryRecommendations["rows"]) {
  const { recordFor } = useRegistryRecords();
  const hydrated = useMemo<HydratedRegistryRow[]>(
    () =>
      rows.map(({ row, fit }) => {
        const instance = recordFor("model-instance", row.model_instance_id);
        const modelId =
          instance && instance !== "error" ? String(instance["model_id"] ?? "") : "";
        return {
          row,
          fit,
          hardware: recordFor("hardware", row.hardware_id),
          instance,
          recipe: recordFor("recipe", row.id),
          model: modelId ? recordFor("model", modelId) : null,
        };
      }),
    [rows, recordFor],
  );
  return hydrated;
}
