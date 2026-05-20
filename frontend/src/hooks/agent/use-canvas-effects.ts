import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { ComputerState } from "@/lib/agent/tools/types";

export function useCanvasEffects({
  setComputer,
}: {
  setComputer: Dispatch<SetStateAction<ComputerState>>;
}): void {
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/canvas", { cache: "no-store" })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ enabled?: boolean; text?: string }>)
          : Promise.reject(new Error("Canvas fetch failed")),
      )
      .then((payload) => {
        if (cancelled) return;
        setComputer((current) => ({
          ...current,
          canvasEnabled: payload.enabled ?? current.canvasEnabled,
          canvasText: typeof payload.text === "string" ? payload.text : current.canvasText,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setComputer]);
}
