"use client";

import { useControllerEvents } from "@/hooks/use-controller-events";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { initAppStoreListeners } from "@/store";

export function GlobalListeners() {
  useControllerEvents();
  useMountSubscription(() => {
    initAppStoreListeners();
  }, []);
  return null;
}
