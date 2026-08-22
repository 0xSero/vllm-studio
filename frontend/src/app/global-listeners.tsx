"use client";

import { useControllerEvents } from "@/hooks/use-controller-events";
import { useUsageSync } from "@/hooks/use-usage-sync";

export function GlobalListeners() {
  useControllerEvents();
  useUsageSync();
  return null;
}
