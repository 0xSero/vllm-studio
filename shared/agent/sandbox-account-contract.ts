import { Schema } from "effect";

export const SandboxProviderSchema = Schema.Literals(["daytona", "vercel"]);
export const SandboxMachineProfileIdSchema = Schema.Literals(["light", "standard", "large"]);
export const SandboxStorageSchema = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("fixed"), gib: Schema.Number }),
  Schema.Struct({ mode: Schema.Literal("provider-managed") }),
]);
export const SandboxMachineProfileSchema = Schema.Struct({
  id: SandboxMachineProfileIdSchema,
  label: Schema.String,
  cpu: Schema.Number,
  memoryGiB: Schema.Number,
  storage: SandboxStorageSchema,
});

export const SandboxAccountEntrySchema = Schema.Struct({
  id: Schema.String,
  provider: SandboxProviderSchema,
  label: Schema.String,
  endpoint: Schema.String,
  teamId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  workerImage: Schema.NullOr(Schema.String),
  defaultProfile: SandboxMachineProfileIdSchema,
  profiles: Schema.Array(SandboxMachineProfileSchema),
  connectedAt: Schema.String,
  secretProvider: Schema.String,
});

export const SandboxAccountsResponseSchema = Schema.Struct({
  accounts: Schema.Array(SandboxAccountEntrySchema),
});

export type SandboxProvider = typeof SandboxProviderSchema.Type;
export type SandboxMachineProfileId = typeof SandboxMachineProfileIdSchema.Type;
export type SandboxStorage = typeof SandboxStorageSchema.Type;
export type SandboxMachineProfile = typeof SandboxMachineProfileSchema.Type;
export type SandboxAccountEntry = typeof SandboxAccountEntrySchema.Type;
