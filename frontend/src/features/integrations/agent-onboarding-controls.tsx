"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type {
  OnboardingProbeResult,
  OnboardingRecovery,
  OnboardingReceipt,
} from "@local-studio/agent-runtime/agent-onboarding-contract";
import { FormField, Input } from "@/ui";

export type ProbeTarget = "vault" | "gitlab" | "jira" | "runtime" | "search" | "remote-agent";
type ClaimState = "observed" | "claimed" | "attested" | "contradicted";

const claimGlyph: Record<ClaimState, string> = {
  observed: "⊢",
  claimed: "○",
  attested: "◆",
  contradicted: "⊭",
};

const probeLabel = (probe: OnboardingProbeResult | undefined) => {
  if (!probe) return "Not verified";
  return probe.ok ? `Verified · ${probe.status}` : `Verification failed · ${probe.status}`;
};

const probeClaim = (probe: OnboardingProbeResult | undefined): ClaimState =>
  probe ? (probe.ok ? "observed" : "contradicted") : "claimed";

const compactDigest = (digest: string) =>
  digest.length > 28 ? `${digest.slice(0, 15)}…${digest.slice(-10)}` : digest;

export function ClaimMark({ state, children }: { state: ClaimState; children: ReactNode }) {
  return (
    <span
      data-claim-state={state}
      className={`inline-flex min-h-7 items-center gap-2 font-mono text-[length:var(--fs-xs)] ${
        state === "attested" ? "text-(--proof)" : "text-(--ui-muted)"
      }`}
    >
      <span aria-hidden="true">{claimGlyph[state]}</span>
      <span>{state}</span>
      <span className="text-(--ui-fg)">{children}</span>
    </span>
  );
}

export function OnboardingButton({
  busy,
  intent = "quiet",
  className = "",
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  intent?: "primary" | "quiet";
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center border px-4 text-[length:var(--fs-sm)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:cursor-not-allowed disabled:opacity-50 forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText] ${
        intent === "primary"
          ? "border-(--ui-fg) bg-(--ui-fg) text-(--ui-bg)"
          : "border-(--ui-border) bg-transparent text-(--ui-fg) hover:bg-(--ui-hover)"
      } ${className}`}
      {...props}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

export function ProbeControl({
  target,
  probe,
  busy,
  disabled,
  onProbe,
}: {
  target: ProbeTarget;
  probe?: OnboardingProbeResult;
  busy: boolean;
  disabled?: boolean;
  onProbe: (target: ProbeTarget) => Promise<void>;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
      <div>
        <ClaimMark state={probeClaim(probe)}>{probeLabel(probe)}</ClaimMark>
        {probe ? (
          <p className="mt-1 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            Checked <time dateTime={probe.checkedAt}>{probe.checkedAt}</time>
          </p>
        ) : null}
      </div>
      <OnboardingButton
        busy={busy}
        disabled={disabled}
        aria-label={`Verify ${target}`}
        onClick={() => void onProbe(target)}
      >
        Verify
      </OnboardingButton>
    </div>
  );
}

export function CredentialField({
  credentialRef,
  stored,
  value,
  onChange,
}: {
  credentialRef: string;
  stored: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label="Credential"
      description={`${credentialRef} · ${
        stored ? "A value is stored in the native keyring." : "No stored value is reported."
      }`}
    >
      <Input
        type="password"
        autoComplete="off"
        className="min-h-11 rounded-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={stored ? "Replace stored credential" : "Enter credential"}
      />
    </FormField>
  );
}

export function FactGrid({ facts }: { facts: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-[length:var(--fs-sm)] sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="text-(--ui-muted)">{label}</dt>
          <dd className="mt-1 break-all font-mono text-[length:var(--fs-xs)] text-(--ui-fg)">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function OnboardingEvidenceMargin({
  requiredTargets,
  probes,
  receipt,
  recovery,
}: {
  requiredTargets: readonly string[];
  probes: readonly OnboardingProbeResult[];
  receipt: OnboardingReceipt | null;
  recovery: OnboardingRecovery | null;
}) {
  return (
    <aside
      aria-labelledby="onboarding-evidence-title"
      className="border-t border-(--ui-border) bg-(--ui-subtle)/35 p-4 forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] lg:border-t-0 lg:border-l"
    >
      <div
        id="onboarding-evidence-title"
        className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)"
      >
        Evidence margin
      </div>
      <p className="mt-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
        Controller observations required by the current profile.
      </p>
      <div className="mt-4 space-y-4">
        {recovery ? (
          <section aria-label="Recovery required" className="border-b border-(--ui-separator) pb-4">
            <ClaimMark state="contradicted">Recovery required · {recovery.operation}</ClaimMark>
            <time
              dateTime={recovery.failedAt}
              className="mt-1 block font-mono text-[length:var(--fs-xs)] text-(--ui-muted)"
            >
              {recovery.failedAt}
            </time>
            <ul className="mt-2 space-y-1 text-[length:var(--fs-xs)] text-(--ui-fg)">
              {recovery.failures.map((failure) => (
                <li key={failure}>⊭ {failure}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {requiredTargets.length === 0 ? (
          <ClaimMark state="claimed">No probes required</ClaimMark>
        ) : (
          requiredTargets.map((target) => {
            const result = probes.find((probe) => probe.target === target);
            return (
              <section
                key={target}
                aria-label={`${target} evidence`}
                className="border-t border-(--ui-separator) pt-3 first:border-0 first:pt-0"
              >
                <ClaimMark state={probeClaim(result)}>{target}</ClaimMark>
                <div className="mt-1 text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {probeLabel(result)}
                </div>
                <div className="mt-1 break-all font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {result ? (
                    <time dateTime={result.checkedAt}>{result.checkedAt}</time>
                  ) : (
                    "No observation recorded"
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>
      {receipt ? (
        <section
          aria-label="Enrollment receipt"
          className="mt-5 border-t border-(--ui-separator) pt-4"
        >
          <ClaimMark state="observed">Enrollment receipt · unsigned</ClaimMark>
          <button
            type="button"
            title={receipt.profileDigest}
            aria-label={`Copy enrollment receipt digest ${receipt.profileDigest}`}
            onClick={() => void navigator.clipboard.writeText(receipt.profileDigest)}
            className="mt-2 min-h-11 w-full border border-(--ui-border) px-2 py-2 text-left font-mono text-[13px] text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) forced-colors:border-[ButtonText] forced-colors:text-[ButtonText]"
          >
            ⊛ {compactDigest(receipt.profileDigest)}
            <span className="ml-2 text-[length:var(--fs-xs)]">copy</span>
          </button>
          <time
            dateTime={receipt.appliedAt}
            className="mt-2 block font-mono text-[length:var(--fs-xs)] text-(--ui-muted)"
          >
            {receipt.appliedAt}
          </time>
        </section>
      ) : (
        <div className="mt-5 border-t border-(--ui-separator) pt-4">
          <ClaimMark state="claimed">Enrollment receipt not issued</ClaimMark>
        </div>
      )}
    </aside>
  );
}
