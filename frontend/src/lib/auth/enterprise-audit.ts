import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type EnterpriseAuditEvent = {
  event:
    | "backchannel_logout"
    | "login"
    | "logout"
    | "token_refresh"
    | "token_refresh_failure"
    | "session_denied";
  subject?: string;
  issuer_id?: string;
  tenant?: string;
  reason?: string;
};

export const emitEnterpriseAudit = (event: EnterpriseAuditEvent): void => {
  const dataDir = resolve(
    process.env.LOCAL_STUDIO_DATA_DIR?.trim() || resolve(process.cwd(), "data"),
  );
  const path = resolve(dataDir, "enterprise-audit.jsonl");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(
    path,
    `${JSON.stringify({
      schema: "local-studio.enterprise-audit/v1",
      timestamp: new Date().toISOString(),
      ...event,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(path, 0o600);
};
