import { Schema } from "effect";

export const HARNESS_REMOTE_DATA_CONSENT_VERSION = "local_studio.harness_remote_data.v1";
export const HARNESS_REMOTE_DATA_CONSENT_HEADER = "x-local-studio-harness-consent";
export const HARNESS_INTEGRATION_CONTRACT_VERSION = "local_studio.harness_integration.v1";

export const HarnessVerificationCheckSchema = Schema.Struct({
  name: Schema.String,
  passed: Schema.Boolean,
  message: Schema.optional(Schema.String),
  independent: Schema.Boolean,
  source: Schema.String,
});

export type HarnessVerificationCheck = Schema.Schema.Type<typeof HarnessVerificationCheckSchema>;

export type HarnessIntegrationContract = {
  contract: typeof HARNESS_INTEGRATION_CONTRACT_VERSION;
  target: "managed" | "provider";
  ownership: "external";
  configuration_source: "server_environment";
  lifecycle: {
    state: "reachable";
    install: "external";
    start: "external";
    stop: "external";
  };
  remote_data: {
    mutation_consent_required: true;
    consent_version: typeof HARNESS_REMOTE_DATA_CONSENT_VERSION;
  };
};

export function decodeHarnessVerificationCheck(value: unknown): HarnessVerificationCheck | null {
  try {
    const decoded = Schema.decodeUnknownSync(HarnessVerificationCheckSchema)(value);
    if (!decoded.name.trim() || !decoded.source.trim()) return null;
    return decoded;
  } catch {
    return null;
  }
}
