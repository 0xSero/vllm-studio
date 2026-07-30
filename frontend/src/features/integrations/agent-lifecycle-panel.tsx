"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  AgentLifecycleProfileSchema,
  AgentLifecycleReceiptSchema,
  AgentLifecycleRecoverySchema,
} from "@local-studio/agent-runtime/agent-lifecycle-view-contract";
import { OnboardingProfileSchema } from "@local-studio/agent-runtime/agent-onboarding-contract";
import { ClaimMark, OnboardingButton } from "./agent-onboarding-controls";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const LifecycleStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  profile: Schema.NullOr(AgentLifecycleProfileSchema),
  receipt: Schema.NullOr(AgentLifecycleReceiptSchema),
  recovery: Schema.NullOr(AgentLifecycleRecoverySchema),
  updatedAt: Schema.String,
  actions: Schema.optional(Schema.Array(Schema.String)),
});

const OnboardingStateSchema = Schema.Struct({
  profile: OnboardingProfileSchema,
});

type LifecycleState = typeof LifecycleStateSchema.Type;
type LifecycleAction = "plan" | "apply" | "reconcile" | "revoke" | "recover";

const decodeLifecycle = Schema.decodeUnknownSync(LifecycleStateSchema, {
  onExcessProperty: "error",
});
const decodeOnboarding = Schema.decodeUnknownSync(OnboardingStateSchema);

const requestJson = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof Reflect.get(body, "error") === "string"
        ? Reflect.get(body, "error")
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
};

const compactDigest = (digest: string) =>
  digest.length > 30 ? `${digest.slice(0, 17)}…${digest.slice(-10)}` : digest;

const lifecycleStanding = (state: LifecycleState | null) => {
  if (state?.recovery) return { claim: "contradicted" as const, label: "Recovery required" };
  if (state?.receipt) return { claim: "observed" as const, label: "Configuration applied" };
  if (state?.profile) return { claim: "claimed" as const, label: "Plan ready" };
  return { claim: "claimed" as const, label: "Not planned" };
};

function LifecycleActions({
  state,
  busy,
  execute,
}: {
  state: LifecycleState | null;
  busy: LifecycleAction | "load" | "";
  execute: (action: LifecycleAction) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <OnboardingButton busy={busy === "plan"} onClick={() => execute("plan")}>
        Plan setup
      </OnboardingButton>
      <OnboardingButton
        intent="primary"
        busy={busy === "apply"}
        disabled={!state?.profile || Boolean(state.receipt) || Boolean(state.recovery)}
        onClick={() => execute("apply")}
      >
        Apply setup
      </OnboardingButton>
      <OnboardingButton
        busy={busy === "reconcile"}
        disabled={!state?.profile || Boolean(state.recovery)}
        onClick={() => execute("reconcile")}
      >
        Reconcile
      </OnboardingButton>
      <OnboardingButton
        busy={busy === "revoke"}
        disabled={!state?.receipt || Boolean(state.recovery)}
        onClick={() => execute("revoke")}
      >
        Offboard
      </OnboardingButton>
      <OnboardingButton
        busy={busy === "recover"}
        disabled={!state?.recovery}
        onClick={() => execute("recover")}
      >
        Recover
      </OnboardingButton>
    </div>
  );
}

export function AgentLifecyclePanel() {
  const [state, setState] = useState<LifecycleState | null>(null);
  const [busy, setBusy] = useState<LifecycleAction | "load" | "">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      setState(decodeLifecycle(await requestJson("/api/agent/lifecycle")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lifecycle state is unavailable");
    } finally {
      setBusy("");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const execute = useCallback(
    async (action: LifecycleAction) => {
      setBusy(action);
      setError("");
      try {
        if (action === "plan") {
          const onboarding = decodeOnboarding(await requestJson("/api/agent/onboarding"));
          setState(
            decodeLifecycle(
              await requestJson("/api/agent/lifecycle/plan", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ profile: onboarding.profile }),
              }),
            ),
          );
        } else {
          const route = action === "recover" ? "recover" : "apply";
          const method = action === "revoke" ? "DELETE" : "POST";
          setState(decodeLifecycle(await requestJson(`/api/agent/lifecycle/${route}`, { method })));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Lifecycle operation failed");
        await load();
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const standing = lifecycleStanding(state);

  return (
    <section
      aria-labelledby="agent-lifecycle-title"
      aria-busy={Boolean(busy)}
      className="mt-6 border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
    >
      <header className="grid gap-3 border-b border-(--ui-separator) px-5 py-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
            Agent configuration lifecycle
          </p>
          <h2 id="agent-lifecycle-title" className="mt-1 text-[length:var(--fs-lg)] font-medium">
            Provision local coding agents
          </h2>
          <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
            Plan, apply, reconcile and restore Pi, OpenCode, Droid, Hermes and Oh My Pi
            configuration with bounded receipts.
          </p>
        </div>
        <ClaimMark state={standing.claim}>{standing.label}</ClaimMark>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0 p-5">
          {error ? (
            <p
              role="alert"
              className="mb-4 border border-(--ui-border) p-3 text-[length:var(--fs-sm)]"
            >
              ⊭ contradicted · {error}
            </p>
          ) : null}
          <LifecycleActions state={state} busy={busy} execute={(action) => void execute(action)} />
          <p
            aria-live="polite"
            className="mt-4 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)"
          >
            {busy
              ? `○ claimed · ${busy}`
              : `${state?.profile?.targets.length ?? 0} targets in scope`}
          </p>
        </main>

        <aside
          aria-label="Lifecycle evidence"
          className="border-t border-(--ui-separator) p-5 lg:border-l lg:border-t-0"
        >
          <p className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
            Evidence margin
          </p>
          {state?.receipt ? (
            <div className="mt-4 space-y-3">
              <ClaimMark state="observed">Configuration receipt</ClaimMark>
              <button
                type="button"
                title="Copy profile digest"
                className="min-h-11 break-all text-left font-mono text-[length:var(--fs-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(state.receipt!.profileDigest)
                    .catch(() => undefined)
                }
              >
                {compactDigest(state.receipt.profileDigest)}
              </button>
              <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                {state.receipt.targets.length} target receipt
                {state.receipt.targets.length === 1 ? "" : "s"}
              </p>
            </div>
          ) : (
            <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-muted)">
              No applied configuration receipt.
            </p>
          )}
          {state?.recovery ? (
            <div className="mt-4 border-t border-(--ui-separator) pt-4">
              <ClaimMark state="contradicted">Recovery pending</ClaimMark>
              <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                {state.recovery.failures.join("; ")}
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      <footer className="border-t border-(--ui-separator) px-5 py-3 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
        C2 · derived · mode changes deployment, not governance semantics
      </footer>
    </section>
  );
}
