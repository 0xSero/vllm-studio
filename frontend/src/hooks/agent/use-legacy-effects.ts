import { useEffect, type DependencyList, type EffectCallback } from "react";

export function useLegacyEffect(effect: EffectCallback, deps?: DependencyList): void {
  useEffect(effect, deps);
}
