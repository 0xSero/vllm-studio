"use client";

import { useCallback, useState } from "react";
import {
  SetupCommissioningProfileSchema,
  type SetupCommissioningProfile,
  type SetupCommissioningSave,
} from "@local-studio/contracts/setup-commissioning";
import { Schema } from "effect";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const decodeProfile = Schema.decodeUnknownSync(SetupCommissioningProfileSchema);

const requestProfile = async (
  method = "GET",
  body?: SetupCommissioningSave | { target: string },
): Promise<SetupCommissioningProfile> => {
  const response = await fetch("/api/setup/commissioning", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Commissioning API returned HTTP ${response.status}`;
    throw new Error(detail);
  }
  return decodeProfile(payload);
};

export function useCommissioningProfile() {
  const [profile, setProfile] = useState<SetupCommissioningProfile | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setProfile(await requestProfile());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commissioning profile failed to load");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: SetupCommissioningSave) => {
    setBusy("save");
    setError("");
    try {
      const next = await requestProfile("PUT", input);
      setProfile(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commissioning profile was not saved");
      return null;
    } finally {
      setBusy("");
    }
  }, []);

  const probe = useCallback(async (target: string) => {
    setBusy(`probe:${target}`);
    setError("");
    try {
      const next = await requestProfile("POST", { target });
      setProfile(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Commissioning probe failed");
      return null;
    } finally {
      setBusy("");
    }
  }, []);

  return { profile, setProfile, busy, error, load, save, probe };
}

export type CommissioningProfileController = ReturnType<typeof useCommissioningProfile>;
