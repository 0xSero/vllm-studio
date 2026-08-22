"use client";

import { useMountSubscription } from "./use-mount-subscription";
import api from "@/lib/api/client";
import {
  createHeadApiClient,
  getHeadConnection,
  HEAD_CONNECTION_CHANGED_EVENT,
} from "@/lib/api/head-controller";

const SYNC_INTERVAL_MS = 30_000;

const syncUsage = async (): Promise<void> => {
  if (!getHeadConnection()) return;
  const events = await api.getUsageOutbox();
  if (events.length === 0) return;
  const accepted = await createHeadApiClient().ingestUsageEvents(events);
  if (accepted.length > 0) await api.acknowledgeUsageEvents(accepted);
};

export const useUsageSync = (): void => {
  useMountSubscription(() => {
    const run = () => void syncUsage().catch(() => undefined);
    run();
    const timer = window.setInterval(run, SYNC_INTERVAL_MS);
    window.addEventListener("online", run);
    window.addEventListener(HEAD_CONNECTION_CHANGED_EVENT, run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener(HEAD_CONNECTION_CHANGED_EVENT, run);
    };
  }, []);
};
