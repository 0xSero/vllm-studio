"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import { ProvisioningStateSchema } from "@local-studio/agent-runtime/provisioning-coordinator-view-contract";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ClaimMark, OnboardingButton } from "./agent-onboarding-controls";

type ProvisioningState = typeof ProvisioningStateSchema.Type;
type Operation = "setup" | "reconcile" | "offboard" | "recover";

const decodeState = Schema.decodeUnknownSync(ProvisioningStateSchema, {
  onExcessProperty: "error",
});

const requestState = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof Reflect.get(body, "error") === "string"
        ? Reflect.get(body, "error")
        : `Provisioning request failed (${response.status})`;
    throw new Error(message);
  }
  return decodeState(body);
};

const phaseLabel = (phase: ProvisioningState["phase"]) =>
  phase
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const stateClaim = (state: ProvisioningState | null) => {
  if (state?.phase === "recovery_required") return "contradicted" as const;
  if (state?.phase === "active" || state?.phase === "revoked") return "observed" as const;
  return "claimed" as const;
};

const participantRows = (state: ProvisioningState) =>
  [
    ["Machine", state.bindings.machine?.receiptId ?? "Pending"],
    ["Access", state.bindings.access?.receiptId ?? "Pending"],
    ["Agents", state.bindings.agents?.receiptId ?? "Pending"],
  ] as const;

export function ProvisioningPanel() {
  const [state, setState] = useState<ProvisioningState | null>(null);
  const [busy, setBusy] = useState<Operation | "load" | "">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      setState(await requestState("/api/agent/provisioning"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provisioning state is unavailable");
    } finally {
      setBusy("");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const execute = useCallback(
    async (operation: Operation) => {
      if (!state) return;
      setBusy(operation);
      setError("");
      try {
        const path =
          operation === "offboard"
            ? "/api/agent/provisioning"
            : `/api/agent/provisioning/${operation}`;
        setState(
          await requestState(path, {
            method: operation === "offboard" ? "DELETE" : "POST",
            ...(operation === "setup"
              ? {
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(state.profile),
                }
              : {}),
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Provisioning operation failed");
        await load();
      } finally {
        setBusy("");
      }
    },
    [load, state],
  );

  return (
    <section
      aria-labelledby="provisioning-title"
      aria-busy={Boolean(busy)}
      className="border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
    >
      <header className="grid gap-3 border-b border-(--ui-separator) px-5 py-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
            Governed provisioning
          </p>
          <h2 id="provisioning-title" className="mt-1 text-[length:var(--fs-lg)] font-medium">
            Machine, access and agent coordination
          </h2>
          <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
            Execute the admitted participant plans in order and reverse them from one receipt.
          </p>
        </div>
        <ClaimMark state={stateClaim(state)}>
          {state ? phaseLabel(state.phase) : "State unavailable"}
        </ClaimMark>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 p-5">
          {error ? (
            <p
              role="alert"
              className="mb-4 border border-(--ui-border) p-3 text-[length:var(--fs-sm)]"
            >
              ⊭ contradicted · {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <OnboardingButton
              intent="primary"
              busy={busy === "setup"}
              disabled={!state?.profile || !["idle", "revoked"].includes(state.phase)}
              onClick={() => void execute("setup")}
            >
              Setup admitted plan
            </OnboardingButton>
            <OnboardingButton
              busy={busy === "reconcile"}
              disabled={state?.phase !== "active"}
              onClick={() => void execute("reconcile")}
            >
              Reconcile participants
            </OnboardingButton>
            <OnboardingButton
              busy={busy === "offboard"}
              disabled={!state || ["idle", "revoked", "recovery_required"].includes(state.phase)}
              onClick={() => void execute("offboard")}
            >
              Offboard all
            </OnboardingButton>
            <OnboardingButton
              busy={busy === "recover"}
              disabled={state?.phase !== "recovery_required"}
              onClick={() => void execute("recover")}
            >
              Recover transaction
            </OnboardingButton>
          </div>
          {!state?.profile ? (
            <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-muted)">
              No admitted coordinator profile is available. Complete and admit the machine, access
              and agent plans before setup.
            </p>
          ) : null}
          <p
            aria-live="polite"
            className="mt-4 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)"
          >
            {busy ? `○ claimed · ${busy}` : state ? `Phase · ${state.phase}` : "No state loaded"}
          </p>
        </main>

        <aside
          aria-label="Provisioning lineage"
          className="border-t border-(--ui-separator) p-5 lg:border-l lg:border-t-0"
        >
          <p className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
            Participant lineage
          </p>
          {state ? (
            <dl className="mt-4 space-y-3">
              {participantRows(state).map(([participant, receipt]) => (
                <div key={participant}>
                  <dt className="text-[length:var(--fs-xs)] text-(--ui-muted)">{participant}</dt>
                  <dd className="break-all font-mono text-[length:var(--fs-sm)]">{receipt}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {state?.recovery ? (
            <div className="mt-4 border-t border-(--ui-separator) pt-4">
              <ClaimMark state="contradicted">Recovery required</ClaimMark>
              <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                Pending ·{" "}
                {state.recovery.pending
                  .map((step) => `${step.participant}.${step.action}`)
                  .join(", ")}
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
