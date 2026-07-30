"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Schema } from "effect";
import {
  OnboardingStateSchema,
  type OnboardingProfile,
  type OnboardingState,
} from "@local-studio/agent-runtime/agent-onboarding-contract";
import { CheckboxRow, FormField, FormSection, Input, PageState } from "@/ui";
import { KeyRound, Server, ShieldCheck, Terminal } from "@/ui/icon-registry";
import type { LocalAgentTarget } from "@/features/settings/local-agents";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  ClaimMark,
  FactGrid,
  OnboardingButton,
  OnboardingEvidenceMargin,
  ProbeControl,
  type ProbeTarget,
} from "./agent-onboarding-controls";
import {
  EnrollmentReviewStep,
  EnterpriseServicesStep,
  RuntimeSearchStep,
} from "./agent-onboarding-service-steps";

type StepId = "boundary" | "services" | "runtime" | "agents" | "review";

const steps: Array<{ id: StepId; label: string }> = [
  { id: "boundary", label: "Boundary" },
  { id: "services", label: "Enterprise services" },
  { id: "runtime", label: "Runtime and search" },
  { id: "agents", label: "Agents" },
  { id: "review", label: "Review and apply" },
];

const decodeState = Schema.decodeUnknownSync(OnboardingStateSchema);

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

const probeFor = (state: OnboardingState, target: string) =>
  state.probes.find((probe) => probe.target === target);

const enrollmentStatus = (state: OnboardingState, ready: boolean, replacementPending: boolean) => {
  if (state.recovery) return { claim: "contradicted" as const, label: "Recovery required" };
  if (replacementPending) return { claim: "contradicted" as const, label: "Revoke before reapply" };
  if (state.receipt) return { claim: "observed" as const, label: "Enrolled" };
  if (ready) return { claim: "observed" as const, label: "Ready to apply" };
  return { claim: "claimed" as const, label: "Verification required" };
};

const keyringLabel = (available: boolean) =>
  available ? "Encrypted storage available" : "Desktop app required";

const probeIsCurrent = (state: OnboardingState, target: string) => {
  const result = probeFor(state, target);
  return Boolean(result?.ok && Date.parse(result.checkedAt) > Date.now() - 10 * 60 * 1000);
};

const onboardingReady = (state: OnboardingState | null, targets: readonly string[]) =>
  state ? targets.every((target) => probeIsCurrent(state, target)) : false;

const receiptMatchesEvidence = (state: OnboardingState, targets: readonly string[]) => {
  if (!state.receipt) return true;
  return targets.every((target) => {
    const result = probeFor(state, target);
    return Boolean(
      result &&
      (result.profileDigest === undefined || result.profileDigest === state.receipt?.profileDigest),
    );
  });
};

function OnboardingWorkingRegion({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  if (embedded) return <div className="min-w-0 p-5">{children}</div>;
  return <main className="min-w-0 p-5">{children}</main>;
}

export function AgentOnboardingWizard({ embedded = false }: { embedded?: boolean } = {}) {
  const [step, setStep] = useState<StepId>("boundary");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [agents, setAgents] = useState<LocalAgentTarget[]>([]);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [profileEdited, setProfileEdited] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextState, localAgents] = await Promise.all([
        requestJson<unknown>("/api/agent/onboarding", { cache: "no-store" }),
        requestJson<{ agents: LocalAgentTarget[] }>("/api/local-agents", { cache: "no-store" }),
      ]);
      setState(decodeState(nextState));
      setAgents(localAgents.agents ?? []);
      setProfileEdited(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Onboarding state failed to load");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const updateProfile = useCallback((change: (profile: OnboardingProfile) => OnboardingProfile) => {
    setState((current) => (current ? { ...current, profile: change(current.profile) } : current));
    setProfileEdited(true);
  }, []);
  const setCredential = useCallback((ref: string, value: string) => {
    setCredentials((current) => ({ ...current, [ref]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!state) return null;
    setBusy("save");
    setError("");
    try {
      const next = decodeState(
        await requestJson<unknown>("/api/agent/onboarding", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: state.profile,
            credentials: Object.entries(credentials)
              .filter(([, value]) => value.length > 0)
              .map(([ref, value]) => ({ ref, value })),
          }),
        }),
      );
      setState(next);
      setCredentials({});
      setProfileEdited((current) => current && next.receipt !== null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Onboarding save failed");
      return null;
    } finally {
      setBusy("");
    }
  }, [credentials, state]);

  const probe = useCallback(
    async (target: ProbeTarget) => {
      const saved = await save();
      if (!saved) return;
      setBusy(`probe:${target}`);
      setError("");
      try {
        await requestJson("/api/agent/onboarding/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        });
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `${target} probe failed`);
      } finally {
        setBusy("");
      }
    },
    [load, save],
  );

  const apply = useCallback(async () => {
    const saved = await save();
    if (!saved) return;
    setBusy("apply");
    setError("");
    try {
      setState(
        decodeState(
          await requestJson("/api/agent/onboarding/apply", {
            method: "POST",
          }),
        ),
      );
      setProfileEdited(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enrollment failed");
    } finally {
      setBusy("");
    }
  }, [save]);

  const revoke = useCallback(async () => {
    setBusy("revoke");
    setError("");
    try {
      setState(
        decodeState(
          await requestJson("/api/agent/onboarding/apply", {
            method: "DELETE",
          }),
        ),
      );
      setProfileEdited(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revocation failed");
    } finally {
      setBusy("");
    }
  }, []);

  const activeIndex = steps.findIndex((candidate) => candidate.id === step);
  const requiredTargets = useMemo(() => {
    if (!state) return [];
    return [
      "runtime",
      ...state.profile.services.filter((service) => service.enabled).map((service) => service.id),
      ...(state.profile.search.enabled ? ["search"] : []),
      ...(state.profile.remoteAgent.enabled ? ["remote-agent"] : []),
    ];
  }, [state]);
  const ready = onboardingReady(state, requiredTargets);
  if (!state) {
    return (
      <PageState
        loading={!error}
        data={null}
        hasData={false}
        error={error}
        onLoad={() => void load()}
      />
    );
  }
  const replacementPending =
    !state.recovery &&
    Boolean(state.receipt) &&
    (profileEdited || !receiptMatchesEvidence(state, requiredTargets));
  const enrollment = enrollmentStatus(state, ready, replacementPending);
  const missingTargets = requiredTargets.filter((target) => !probeIsCurrent(state, target));

  return (
    <section
      aria-labelledby="agent-onboarding-title"
      className="border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
    >
      <header className="grid gap-4 border-b border-(--ui-separator) px-5 py-5 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.18em] text-(--ui-muted)">
            CortAIx factory · C2
          </div>
          <h2
            id="agent-onboarding-title"
            className="mt-2 text-[length:var(--fs-xl)] font-medium text-(--ui-fg)"
          >
            Agent onboarding wizard
          </h2>
          <p className="mt-1 max-w-3xl text-[length:var(--fs-sm)] text-(--ui-muted)">
            Enroll enterprise services, keyring-backed model access, search, and execution targets
            under one revocable profile.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <ClaimMark state="observed">C2 boundary loaded</ClaimMark>
          <ClaimMark state={enrollment.claim}>{enrollment.label}</ClaimMark>
        </div>
      </header>

      <nav
        aria-label="Onboarding progress"
        className="grid grid-cols-2 border-b border-(--ui-separator) md:grid-cols-5"
      >
        {steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            aria-current={item.id === step ? "step" : undefined}
            aria-label={`Step ${index + 1} of ${steps.length}: ${item.label}`}
            className={`min-h-11 border-r border-(--ui-separator) px-3 py-2 text-left text-[length:var(--fs-xs)] ${
              item.id === step
                ? "border-b-2 border-b-(--ui-fg) bg-(--ui-hover) text-(--ui-fg)"
                : "text-(--ui-muted)"
            }`}
          >
            <span className="mr-2 font-mono text-(--ui-muted)">
              {String(index + 1).padStart(2, "0")}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className={embedded ? "grid" : "grid lg:grid-cols-[minmax(0,1fr)_280px]"}>
        <OnboardingWorkingRegion embedded={embedded}>
          <div aria-live="polite" aria-atomic="true">
            {busy ? (
              <p
                role="status"
                className="mb-4 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)"
              >
                ○ claimed · {busy}
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mb-4 border border-(--ui-border) bg-(--ui-bg) p-3 text-[length:var(--fs-sm)] text-(--ui-fg)"
              >
                ⊭ contradicted · {error}
              </p>
            ) : null}
          </div>
          <fieldset disabled={state.recovery !== null} className="min-w-0">
            {step === "boundary" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <FormSection
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Handling boundary"
                  className="rounded-none"
                >
                  <FactGrid
                    facts={[
                      ["Classification", state.profile.classification],
                      ["Authority", "Restricted"],
                      ["Credential policy", "Keyring references"],
                      ["Apply policy", "Verified targets only"],
                    ]}
                  />
                </FormSection>
                <FormSection
                  icon={<KeyRound className="h-4 w-4" />}
                  title="Native keyring"
                  className="rounded-none"
                >
                  <ClaimMark state={state.keyring.available ? "observed" : "contradicted"}>
                    {keyringLabel(state.keyring.available)}
                  </ClaimMark>
                  <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                    {state.keyring.credentialRefs.length} credential reference
                    {state.keyring.credentialRefs.length === 1 ? "" : "s"} present. Secret values
                    are never returned to this page.
                  </p>
                </FormSection>
              </div>
            ) : null}

            {step === "services" ? (
              <EnterpriseServicesStep
                state={state}
                credentials={credentials}
                busy={busy}
                updateProfile={updateProfile}
                setCredential={setCredential}
                probe={probe}
              />
            ) : null}

            {step === "runtime" ? (
              <RuntimeSearchStep
                state={state}
                credentials={credentials}
                busy={busy}
                updateProfile={updateProfile}
                setCredential={setCredential}
                probe={probe}
              />
            ) : null}

            {step === "agents" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <FormSection
                  icon={<Terminal className="h-4 w-4" />}
                  title="Local coding agents"
                  className="rounded-none"
                >
                  {agents.map((agent) => (
                    <CheckboxRow
                      key={agent.agent}
                      checked={state.profile.localAgents.includes(agent.agent)}
                      onChange={(checked) =>
                        updateProfile((profile) => ({
                          ...profile,
                          localAgents: checked
                            ? [...new Set([...profile.localAgents, agent.agent])]
                            : profile.localAgents.filter((value) => value !== agent.agent),
                        }))
                      }
                      label={agent.label}
                      description={agent.configPath}
                      className="rounded-none"
                    />
                  ))}
                </FormSection>
                <FormSection
                  icon={<Server className="h-4 w-4" />}
                  title="Remote agent"
                  className="rounded-none"
                >
                  <CheckboxRow
                    className="rounded-none"
                    checked={state.profile.remoteAgent.enabled}
                    onChange={(enabled) =>
                      updateProfile((profile) => ({
                        ...profile,
                        remoteAgent: { ...profile.remoteAgent, enabled },
                      }))
                    }
                    label="Enroll SSH agent target"
                    description="Key authentication and bundled MCP server."
                  />
                  <FormField label="SSH target">
                    <Input
                      disabled={!state.profile.remoteAgent.enabled}
                      className="min-h-11 rounded-none"
                      value={state.profile.remoteAgent.target}
                      onChange={(event) =>
                        updateProfile((profile) => ({
                          ...profile,
                          remoteAgent: { ...profile.remoteAgent, target: event.target.value },
                        }))
                      }
                      placeholder="scientist@compute-node"
                    />
                  </FormField>
                  <ProbeControl
                    target="remote-agent"
                    probe={probeFor(state, "remote-agent")}
                    busy={busy === "probe:remote-agent"}
                    disabled={!state.profile.remoteAgent.enabled}
                    onProbe={probe}
                  />
                </FormSection>
              </div>
            ) : null}
          </fieldset>

          {step === "review" ? (
            <EnrollmentReviewStep
              state={state}
              requiredTargets={requiredTargets}
              missingTargets={missingTargets}
              ready={ready}
              replacementPending={replacementPending}
              recoveryRequired={state.recovery !== null}
              busy={busy}
              save={save}
              apply={apply}
              revoke={revoke}
            />
          ) : null}
        </OnboardingWorkingRegion>
        {embedded ? null : (
          <OnboardingEvidenceMargin
            requiredTargets={requiredTargets}
            probes={state.probes}
            receipt={state.receipt}
            recovery={state.recovery}
          />
        )}
      </div>

      <footer>
        <div className="flex items-center justify-between border-t border-(--ui-separator) px-5 py-4">
          <OnboardingButton
            disabled={activeIndex === 0}
            onClick={() => setStep(steps[activeIndex - 1]?.id ?? "boundary")}
          >
            Back
          </OnboardingButton>
          {step !== "review" ? (
            <OnboardingButton
              intent="primary"
              onClick={() => setStep(steps[activeIndex + 1]?.id ?? "review")}
            >
              Continue
            </OnboardingButton>
          ) : null}
        </div>
        {embedded ? null : (
          <div
            aria-label="C2 classification, derived from appliance profile"
            className="grid min-h-11 grid-cols-[auto_auto_1fr] items-center gap-x-3 border-t border-(--ui-separator) bg-(--ui-bg) px-5 py-2 font-mono text-[11px] text-(--ui-muted) sm:flex"
          >
            <span className="uppercase tracking-[0.16em]">Classification</span>
            <strong className="text-[13px] font-medium tracking-[0.14em] text-(--ui-fg)">C2</strong>
            <span className="hidden min-w-3 flex-1 sm:block" />
            <span className="uppercase tracking-[0.06em]">Restricted · appliance profile</span>
            <span className="hidden h-4 w-px bg-(--ui-separator) md:block" aria-hidden="true" />
            <span className="col-span-3 font-sans">
              mode changes deployment, not governance semantics
            </span>
          </div>
        )}
      </footer>
    </section>
  );
}
