import { Schema } from "effect";

export const EnterpriseServiceIdSchema = Schema.Union([
  Schema.Literal("vault"),
  Schema.Literal("gitlab"),
  Schema.Literal("jira"),
]);

export const OnboardingServiceSchema = Schema.Struct({
  id: EnterpriseServiceIdSchema,
  name: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  credentialRef: Schema.String,
});

export const OnboardingRuntimeSchema = Schema.Struct({
  baseUrl: Schema.String,
  modelId: Schema.String,
  contextWindow: Schema.Number,
  credentialRef: Schema.String,
});

export const OnboardingSearchSchema = Schema.Struct({
  baseUrl: Schema.String,
  enabled: Schema.Boolean,
  credentialRef: Schema.String,
});

export const OnboardingRemoteAgentSchema = Schema.Struct({
  enabled: Schema.Boolean,
  target: Schema.String,
});

export const OnboardingProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  classification: Schema.Literal("C2"),
  services: Schema.Array(OnboardingServiceSchema),
  runtime: OnboardingRuntimeSchema,
  search: OnboardingSearchSchema,
  remoteAgent: OnboardingRemoteAgentSchema,
  localAgents: Schema.Array(Schema.String),
  updatedAt: Schema.String,
});

export const OnboardingCredentialInputSchema = Schema.Struct({
  ref: Schema.String,
  value: Schema.String,
});

export const OnboardingSaveInputSchema = Schema.Struct({
  profile: OnboardingProfileSchema,
  credentials: Schema.optional(Schema.Array(OnboardingCredentialInputSchema)),
});

export const OnboardingProbeInputSchema = Schema.Struct({
  target: Schema.Union([
    EnterpriseServiceIdSchema,
    Schema.Literal("runtime"),
    Schema.Literal("search"),
    Schema.Literal("remote-agent"),
  ]),
});

export const OnboardingProbeResultSchema = Schema.Struct({
  target: Schema.String,
  ok: Schema.Boolean,
  status: Schema.String,
  detail: Schema.String,
  checkedAt: Schema.String,
  profileDigest: Schema.optional(Schema.String),
});

const OnboardingConnectorSnapshotSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  auth: Schema.optional(
    Schema.Struct({
      type: Schema.Literal("oauth"),
      provider: Schema.String,
      account: Schema.String,
    }),
  ),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(
    Schema.Struct({
      kind: Schema.String,
      id: Schema.String,
      version: Schema.optional(Schema.String),
      binding: Schema.optional(Schema.String),
    }),
  ),
  enabled: Schema.Boolean,
});

const OnboardingLocalAgentResultSchema = Schema.Struct({
  agent: Schema.String,
  ok: Schema.Boolean,
  configPath: Schema.String,
  backupPath: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  extraUpdates: Schema.optional(
    Schema.Array(
      Schema.Struct({
        configPath: Schema.String,
        backupPath: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export const OnboardingReceiptSchema = Schema.Struct({
  id: Schema.String,
  profileDigest: Schema.String,
  appliedAt: Schema.String,
  localAgentResults: Schema.Array(OnboardingLocalAgentResultSchema),
  probes: Schema.Array(OnboardingProbeResultSchema),
  previousConnector: Schema.optional(Schema.NullOr(OnboardingConnectorSnapshotSchema)),
});

export const OnboardingRecoverySchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.Union([Schema.Literal("apply"), Schema.Literal("revoke")]),
  failedAt: Schema.String,
  profileDigest: Schema.String,
  failures: Schema.Array(Schema.String),
  localAgentResults: Schema.optional(Schema.Array(OnboardingLocalAgentResultSchema)),
  previousConnector: Schema.optional(Schema.NullOr(OnboardingConnectorSnapshotSchema)),
});

export const OnboardingStateSchema = Schema.Struct({
  profile: OnboardingProfileSchema,
  keyring: Schema.Struct({
    available: Schema.Boolean,
    credentialRefs: Schema.Array(Schema.String),
  }),
  probes: Schema.Array(OnboardingProbeResultSchema),
  receipt: Schema.NullOr(OnboardingReceiptSchema),
  recovery: Schema.NullOr(OnboardingRecoverySchema),
});

export const FastCrwSearchInputSchema = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
  lang: Schema.optional(Schema.String),
  recency: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String)),
});

export const FastCrwScrapeInputSchema = Schema.Struct({
  url: Schema.String,
  formats: Schema.optional(Schema.Array(Schema.String)),
  onlyMainContent: Schema.optional(Schema.Boolean),
  renderJs: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(Schema.Number),
});

export const FastCrwMapInputSchema = Schema.Struct({
  url: Schema.String,
  maxDepth: Schema.optional(Schema.Number),
  useSitemap: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(Schema.Number),
});

export const FastCrwCrawlInputSchema = Schema.Struct({
  url: Schema.String,
  maxPages: Schema.optional(Schema.Number),
  maxDepth: Schema.optional(Schema.Number),
  formats: Schema.optional(Schema.Array(Schema.String)),
  onlyMainContent: Schema.optional(Schema.Boolean),
});

export const FastCrwCrawlStatusInputSchema = Schema.Struct({
  id: Schema.String,
});

export const FastCrwExtractInputSchema = Schema.Struct({
  urls: Schema.Array(Schema.String),
  prompt: Schema.optional(Schema.String),
  schema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export const FastCrwExtractStatusInputSchema = Schema.Struct({
  id: Schema.String,
});

export type OnboardingProfile = typeof OnboardingProfileSchema.Type;
export type OnboardingProbeInput = typeof OnboardingProbeInputSchema.Type;
export type OnboardingProbeResult = typeof OnboardingProbeResultSchema.Type;
export type OnboardingReceipt = typeof OnboardingReceiptSchema.Type;
export type OnboardingRecovery = typeof OnboardingRecoverySchema.Type;
export type OnboardingState = typeof OnboardingStateSchema.Type;
export type OnboardingSaveInput = typeof OnboardingSaveInputSchema.Type;
export type FastCrwSearchInput = typeof FastCrwSearchInputSchema.Type;
export type FastCrwScrapeInput = typeof FastCrwScrapeInputSchema.Type;
export type FastCrwMapInput = typeof FastCrwMapInputSchema.Type;
export type FastCrwCrawlInput = typeof FastCrwCrawlInputSchema.Type;
export type FastCrwCrawlStatusInput = typeof FastCrwCrawlStatusInputSchema.Type;
export type FastCrwExtractInput = typeof FastCrwExtractInputSchema.Type;
export type FastCrwExtractStatusInput = typeof FastCrwExtractStatusInputSchema.Type;
