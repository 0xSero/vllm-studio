"use client";

import { useSyncExternalStore } from "react";
import {
  getSessionActivity,
  getOpenSessions,
  subscribeSessionActivity,
  subscribeOpenSessions,
  type OpenAgentSession,
} from "@/features/agent/session-index";

export function useOpenSessions(): readonly OpenAgentSession[] {
  return useSyncExternalStore(subscribeOpenSessions, getOpenSessions, getOpenSessions);
}

export function useSessionActivity() {
  return useSyncExternalStore(subscribeSessionActivity, getSessionActivity, getSessionActivity);
}
