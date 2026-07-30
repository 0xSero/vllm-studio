"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import { NormalizedPrincipalSchema } from "@local-studio/contracts/enterprise-auth";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "./settings-ui";
import { FoundryCatalogSection } from "./foundry-catalog-section";

export const EnterpriseSessionViewSchema = Schema.Struct({
  mode: Schema.Literals(["local", "optional_oidc", "required_oidc"]),
  issuers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["entra", "keycloak"]),
      tenant: Schema.optional(Schema.String),
      realm: Schema.optional(Schema.String),
    }),
  ),
  authenticated: Schema.Boolean,
  principal: Schema.NullOr(NormalizedPrincipalSchema),
  expires_at: Schema.NullOr(Schema.String),
});

export type EnterpriseSessionView = typeof EnterpriseSessionViewSchema.Type;

export function EnterpriseAccessSection({
  returnTo = "/settings#enterprise",
}: {
  returnTo?: string;
} = {}) {
  const [session, setSession] = useState<EnterpriseSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error(`Session endpoint returned ${response.status}`);
      setSession(Schema.decodeUnknownSync(EnterpriseSessionViewSchema)(await response.json()));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enterprise session unavailable");
    }
  }, []);

  useMountSubscription(() => {
    void refresh();
    return undefined;
  }, [refresh]);

  const signOut = async () => {
    const response = await fetch(`/api/auth/logout?returnTo=${encodeURIComponent(returnTo)}`, {
      method: "POST",
    });
    const result = (await response.json()) as { logout_path?: unknown };
    if (typeof result.logout_path === "string") {
      window.location.assign(result.logout_path);
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-8">
      <SettingsGroup
        title="Enterprise access"
        description="Deployment-owned OIDC identity and authorization boundary."
        actions={
          <StatusPill
            tone={
              session?.authenticated
                ? "good"
                : session?.mode === "required_oidc"
                  ? "warning"
                  : undefined
            }
          >
            {session?.authenticated ? "token validated" : (session?.mode ?? "checking")}
          </StatusPill>
        }
      >
        <SettingsRow
          label="Deployment mode"
          value={<SettingsValue mono>{session?.mode ?? "observing"}</SettingsValue>}
        />
        <SettingsRow
          label="Identity"
          description={session?.principal?.email ?? "No browser token is exposed or persisted."}
          value={
            <SettingsValue>
              {session?.principal?.display_name ?? (error ? "unavailable" : "not signed in")}
            </SettingsValue>
          }
        />
        <SettingsRow
          label="Tenant and issuer"
          value={
            <SettingsValue mono wrap>
              {session?.principal
                ? `${session.principal.issuer_id} · ${session.principal.tenant}`
                : session?.issuers
                    .map((issuer) => issuer.tenant ?? issuer.realm ?? issuer.id)
                    .join(" · ") || "local"}
            </SettingsValue>
          }
        />
        <SettingsRow
          label="Roles and clearance"
          value={
            <SettingsValue mono wrap>
              {session?.principal
                ? `${session.principal.roles.join(", ")} · ${session.principal.clearance}`
                : "not observed"}
            </SettingsValue>
          }
        />
        <SettingsRow
          label="Session expiry"
          value={
            <SettingsValue mono>
              {session?.expires_at ? new Date(session.expires_at).toLocaleString() : "not active"}
            </SettingsValue>
          }
          actions={
            session?.authenticated ? (
              <SettingsButton onClick={() => void signOut()}>Sign out</SettingsButton>
            ) : null
          }
        />
      </SettingsGroup>
      <SettingsGroup
        title="Trusted issuers"
        description="Issuer metadata is observed after discovery; live APIM and Foundry probes are reported separately."
      >
        {(session?.issuers ?? []).map((issuer) => (
          <SettingsRow
            key={issuer.id}
            label={issuer.kind === "entra" ? "Microsoft Entra ID" : "Keycloak"}
            description={issuer.tenant ?? issuer.realm ?? issuer.id}
            status={<StatusPill>configured</StatusPill>}
            actions={
              !session?.authenticated ? (
                <SettingsButton
                  onClick={() => {
                    window.location.href = `/api/auth/login/${encodeURIComponent(issuer.id)}?returnTo=${encodeURIComponent(returnTo)}`;
                  }}
                >
                  Sign in
                </SettingsButton>
              ) : null
            }
          />
        ))}
        {session?.issuers.length === 0 ? (
          <SettingsRow label="OIDC issuers" value={<SettingsValue>Local mode</SettingsValue>} />
        ) : null}
      </SettingsGroup>
      <FoundryCatalogSection enabled={Boolean(session?.authenticated)} />
    </div>
  );
}
