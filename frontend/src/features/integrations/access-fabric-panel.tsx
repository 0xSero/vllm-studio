"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  AccessFabricStateSchema,
  type AccessFabricProfile,
  type AccessFabricState,
} from "@local-studio/agent-runtime/access-fabric-contract";
import { CheckboxRow, FormField, FormSection, Input, PageState } from "@/ui";
import { Network, ShieldCheck } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const request = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : `HTTP ${response.status}`,
    );
  }
  return body;
};

const compactDigest = (value: string) =>
  value.length > 30 ? `${value.slice(0, 17)}…${value.slice(-10)}` : value;

const Action = ({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="min-h-11 border border-(--ui-border) px-4 text-[length:var(--fs-sm)] text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:opacity-50"
  >
    {children}
  </button>
);

export function AccessFabricPanel() {
  const [state, setState] = useState<AccessFabricState | null>(null);
  const [profile, setProfile] = useState<AccessFabricProfile | null>(null);
  const [credentials, setCredentials] = useState({ netbird: "", boundary: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = Schema.decodeUnknownSync(AccessFabricStateSchema)(
        await request("/api/agent/access-fabric"),
      );
      setState(next);
      setProfile(next.profile);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access fabric load failed");
    }
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const run = async (name: string, url: string, init?: RequestInit) => {
    setBusy(name);
    setError("");
    try {
      const next = Schema.decodeUnknownSync(AccessFabricStateSchema)(await request(url, init));
      setState(next);
      setProfile(next.profile);
      setDirty(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access fabric operation failed");
      return false;
    } finally {
      setBusy("");
    }
  };

  if (!state || !profile) {
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

  const update = (change: (current: AccessFabricProfile) => AccessFabricProfile) => {
    setDirty(true);
    setProfile((current) => (current ? change(current) : current));
  };
  const field = (label: string, value: string, onChange: (value: string) => void) => (
    <FormField label={label}>
      <Input
        className="min-h-11 rounded-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
  const save = async () => {
    const saved = await run("save", "/api/agent/access-fabric", {
      method: "PUT",
      body: JSON.stringify({
        profile,
        credentials: [
          ...(credentials.netbird
            ? [{ ref: "vault:access:netbird", value: credentials.netbird }]
            : []),
          ...(credentials.boundary
            ? [{ ref: "vault:access:boundary", value: credentials.boundary }]
            : []),
        ],
      }),
    });
    if (saved) setCredentials({ netbird: "", boundary: "" });
  };

  return (
    <section aria-labelledby="access-fabric-title" className="border border-(--ui-border)">
      <header className="border-b border-(--ui-separator) p-5">
        <div className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--ui-muted)">
          C2 handling boundary · access fabric
        </div>
        <h2 id="access-fabric-title" className="mt-2 text-[length:var(--fs-xl)] text-(--ui-fg)">
          NetBird network and HashiCorp Boundary targets
        </h2>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
          Configure machine reachability separately from the appliance classification boundary.
        </p>
      </header>
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <FormSection
          icon={<Network className="h-4 w-4" />}
          title="Machine and NetBird"
          className="rounded-none"
        >
          {field("Machine ID", profile.machine.id, (value) =>
            update((current) => ({ ...current, machine: { ...current.machine, id: value } })),
          )}
          {field("SSH target", profile.machine.sshTarget, (value) =>
            update((current) => ({
              ...current,
              machine: { ...current.machine, sshTarget: value },
            })),
          )}
          <CheckboxRow
            checked={profile.netbird.enabled}
            onChange={(enabled) =>
              update((current) => ({ ...current, netbird: { ...current.netbird, enabled } }))
            }
            label="Enable NetBird"
            description="C2 policy-safe management plane enrollment"
            className="rounded-none"
          />
          {field("Management URL", profile.netbird.managementUrl, (value) =>
            update((current) => ({
              ...current,
              netbird: { ...current.netbird, managementUrl: value },
            })),
          )}
          {field("Source group ID", profile.netbird.sourceGroupId, (value) =>
            update((current) => ({
              ...current,
              netbird: { ...current.netbird, sourceGroupId: value },
            })),
          )}
          {field("Machine group ID", profile.netbird.machineGroupId, (value) =>
            update((current) => ({
              ...current,
              netbird: { ...current.netbird, machineGroupId: value },
            })),
          )}
          <FormField label="NetBird credential">
            <Input
              type="password"
              autoComplete="off"
              className="min-h-11 rounded-none"
              value={credentials.netbird}
              onChange={(event) => {
                setDirty(true);
                setCredentials((current) => ({ ...current, netbird: event.target.value }));
              }}
            />
          </FormField>
          <Action
            disabled={!profile.netbird.enabled || Boolean(busy) || dirty}
            onClick={() =>
              void run("probe-netbird", "/api/agent/access-fabric/probe", {
                method: "POST",
                body: JSON.stringify({ target: "netbird" }),
              })
            }
          >
            Verify NetBird
          </Action>
        </FormSection>
        <FormSection
          icon={<ShieldCheck className="h-4 w-4" />}
          title="HashiCorp Boundary"
          className="rounded-none"
        >
          <CheckboxRow
            checked={profile.boundary.enabled}
            onChange={(enabled) =>
              update((current) => ({ ...current, boundary: { ...current.boundary, enabled } }))
            }
            label="Enable Boundary targets"
            description="Bounded target sessions; not the C2 classification boundary"
            className="rounded-none"
          />
          {field("Controller URL", profile.boundary.controllerUrl, (value) =>
            update((current) => ({
              ...current,
              boundary: { ...current.boundary, controllerUrl: value },
            })),
          )}
          {field("Scope ID", profile.boundary.scopeId, (value) =>
            update((current) => ({
              ...current,
              boundary: { ...current.boundary, scopeId: value },
            })),
          )}
          {field("Target IDs, comma separated", profile.boundary.targetIds.join(","), (value) =>
            update((current) => ({
              ...current,
              boundary: {
                ...current.boundary,
                targetIds: value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            })),
          )}
          <FormField label="Boundary credential">
            <Input
              type="password"
              autoComplete="off"
              className="min-h-11 rounded-none"
              value={credentials.boundary}
              onChange={(event) => {
                setDirty(true);
                setCredentials((current) => ({ ...current, boundary: event.target.value }));
              }}
            />
          </FormField>
          <Action
            disabled={!profile.boundary.enabled || Boolean(busy) || dirty}
            onClick={() =>
              void run("probe-boundary", "/api/agent/access-fabric/probe", {
                method: "POST",
                body: JSON.stringify({ target: "boundary" }),
              })
            }
          >
            Verify Boundary
          </Action>
        </FormSection>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-(--ui-separator) p-5">
        <Action disabled={Boolean(busy)} onClick={() => void save()}>
          Save access profile
        </Action>
        <Action
          disabled={Boolean(busy) || dirty}
          onClick={() => void run("plan", "/api/agent/access-fabric/plan", { method: "POST" })}
        >
          Build verified plan
        </Action>
        <Action
          disabled={Boolean(busy) || !state.plan || Boolean(state.receipt)}
          onClick={() => void run("apply", "/api/agent/access-fabric/apply", { method: "POST" })}
        >
          Apply enrollment
        </Action>
        <Action
          disabled={Boolean(busy) || (!state.receipt && !state.recovery)}
          onClick={() =>
            void run("offboard", "/api/agent/access-fabric/apply", { method: "DELETE" })
          }
        >
          Offboard and restore
        </Action>
        <span
          role="status"
          title={state.receipt?.profileDigest ?? state.plan?.digest}
          className={`font-mono text-[length:var(--fs-xs)] ${
            state.receipt ? "text-(--proof)" : "text-(--ui-muted)"
          }`}
        >
          {error ||
            (state.receipt
              ? `◆ attested ${compactDigest(state.receipt.profileDigest)}`
              : state.plan
                ? `⊢ planned ${compactDigest(state.plan.digest)}`
                : "○ claimed · not enrolled")}
        </span>
      </footer>
    </section>
  );
}
