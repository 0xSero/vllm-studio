"use client";

import { Effect, Schema } from "effect";
import { useState } from "react";
import {
  SandboxAccountsResponseSchema,
  type SandboxAccountEntry,
} from "@shared/agent/sandbox-account-contract";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useSandboxAccounts(): readonly SandboxAccountEntry[] {
  const [accounts, setAccounts] = useState<readonly SandboxAccountEntry[]>([]);
  useMountSubscription(() => {
    const controller = new AbortController();
    void Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          fetch("/api/agent/accounts/sandboxes", {
            cache: "no-store",
            signal: controller.signal,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.flatMap((response) =>
          Effect.tryPromise({ try: () => response.json(), catch: (cause) => cause }),
        ),
        Effect.flatMap((payload) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(SandboxAccountsResponseSchema)(payload),
            catch: (cause) => cause,
          }),
        ),
        Effect.catch(() => Effect.succeed({ accounts: [] })),
      ),
    ).then((response) => setAccounts(response.accounts));
    return () => controller.abort();
  }, []);
  return accounts;
}
