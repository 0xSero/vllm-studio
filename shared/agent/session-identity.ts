import { Schema } from "effect";

export const SESSION_IDENTITY_CONTRACT_VERSION = 1 as const;
export const SESSION_RUNTIME_KINDS = ["pi", "codex", "claude", "local-studio", "chatgpt"] as const;
export const SESSION_ARCHIVE_STATES = ["active", "archived"] as const;
export const SESSION_CORE_CAPABILITIES = [
  "session.list",
  "session.read",
  "session.create",
  "session.append",
  "session.turn",
  "session.resume",
  "session.fork",
  "session.archive",
  "session.goal",
  "session.approval",
  "session.pagination",
  "session.command_execution",
  "session.directory_access",
  "session.filesystem_access",
  "session.reasoning",
  "session.tool_lifecycle",
  "session.queue",
  "session.reconnect",
  "session.branch_projection",
] as const;

export const SessionIdentityParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  Schema.annotate<S>({ parseOptions: SessionIdentityParseOptions })(schema);
const IdentifierSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMaxLength(512)),
);
const CapabilityNamePattern = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

export const SessionIdentityContractVersionSchema = Schema.Literal(
  SESSION_IDENTITY_CONTRACT_VERSION,
);

export const EnvironmentRefSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  environmentId: IdentifierSchema,
}).pipe(strict);

export const ExecutionTargetSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  targetId: IdentifierSchema,
  environment: EnvironmentRefSchema,
}).pipe(strict);

export const FilesystemAuthoritySchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  filesystemId: IdentifierSchema,
  target: ExecutionTargetSchema,
}).pipe(strict);

export const ControllerRefSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  controllerId: IdentifierSchema,
}).pipe(strict);

export const SessionRuntimeKindSchema = Schema.Literals(SESSION_RUNTIME_KINDS);

export const RuntimeRefSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  kind: SessionRuntimeKindSchema,
  runtimeId: IdentifierSchema,
}).pipe(strict);

export const SessionIdentitySchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  sessionId: IdentifierSchema,
  runtime: RuntimeRefSchema,
  environment: EnvironmentRefSchema,
}).pipe(strict);

export const SessionRevisionSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);

export const SessionArchiveStateSchema = Schema.Literals(SESSION_ARCHIVE_STATES);

export const SessionCapabilityNameSchema = Schema.NonEmptyString.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(512),
    Schema.isPattern(CapabilityNamePattern),
  ),
);

export const SessionCapabilityStatusSchema = Schema.Struct({
  capability: SessionCapabilityNameSchema,
  available: Schema.Boolean,
  unavailableReason: Schema.NullOr(IdentifierSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.available === (input.unavailableReason === null)
        ? undefined
        : "Availability and unavailableReason must agree",
    ),
  ),
  strict,
);

export const SessionCapabilitiesSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  entries: Schema.Array(SessionCapabilityStatusSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) => {
      const seen = new Set<string>();
      for (const entry of input.entries) {
        if (seen.has(entry.capability)) return `Duplicate capability ${entry.capability}`;
        seen.add(entry.capability);
      }
      for (const capability of SESSION_CORE_CAPABILITIES) {
        if (!seen.has(capability)) return `Missing core capability ${capability}`;
      }
      return undefined;
    }),
  ),
  strict,
);

const keyFor =
  <T>(tuple: (value: T) => SessionKeyTuple) =>
  (value: T): string =>
    JSON.stringify(tuple(value));
const equalsFor =
  <T>(key: (value: T) => string) =>
  (a: T, b: T): boolean =>
    key(a) === key(b);

export const environmentRefTuple = (ref: EnvironmentRef): SessionKeyTuple => [
  "environment-ref",
  ref.contractVersion,
  ref.environmentId,
];
export const environmentRefKey = keyFor(environmentRefTuple);
export const environmentRefEquals = equalsFor(environmentRefKey);

export const executionTargetTuple = (target: ExecutionTarget): SessionKeyTuple => [
  "execution-target",
  target.contractVersion,
  target.targetId,
  environmentRefTuple(target.environment),
];
export const executionTargetKey = keyFor(executionTargetTuple);
export const executionTargetEquals = equalsFor(executionTargetKey);

export const filesystemAuthorityTuple = (authority: FilesystemAuthority): SessionKeyTuple => [
  "filesystem-authority",
  authority.contractVersion,
  authority.filesystemId,
  executionTargetTuple(authority.target),
];
export const filesystemAuthorityKey = keyFor(filesystemAuthorityTuple);
export const filesystemAuthorityEquals = equalsFor(filesystemAuthorityKey);

export const controllerRefTuple = (ref: ControllerRef): SessionKeyTuple => [
  "controller-ref",
  ref.contractVersion,
  ref.controllerId,
];
export const controllerRefKey = keyFor(controllerRefTuple);
export const controllerRefEquals = equalsFor(controllerRefKey);

export const runtimeRefTuple = (ref: RuntimeRef): SessionKeyTuple => [
  "runtime-ref",
  ref.contractVersion,
  ref.kind,
  ref.runtimeId,
];
export const runtimeRefKey = keyFor(runtimeRefTuple);
export const runtimeRefEquals = equalsFor(runtimeRefKey);

export const sessionIdentityTuple = (identity: SessionIdentity): SessionKeyTuple => [
  "session-identity",
  identity.contractVersion,
  identity.sessionId,
  runtimeRefTuple(identity.runtime),
  environmentRefTuple(identity.environment),
];
export const sessionIdentityKey = keyFor(sessionIdentityTuple);
export const sessionIdentityEquals = equalsFor(sessionIdentityKey);

export const filesystemAuthorityBelongsToTarget = (
  authority: FilesystemAuthority,
  target: ExecutionTarget,
): boolean => executionTargetEquals(authority.target, target);

export const SessionPlacementSchema = Schema.Struct({
  contractVersion: SessionIdentityContractVersionSchema,
  session: SessionIdentitySchema,
  target: ExecutionTargetSchema,
  filesystem: FilesystemAuthoritySchema,
  controller: ControllerRefSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      filesystemAuthorityBelongsToTarget(input.filesystem, input.target)
        ? undefined
        : "Filesystem authority must belong to the placement execution target",
    ),
    Schema.makeFilter((input) =>
      environmentRefEquals(input.session.environment, input.target.environment)
        ? undefined
        : "Session environment must equal the placement target environment",
    ),
  ),
  strict,
);

export const sessionPlacementTuple = (placement: SessionPlacement): SessionKeyTuple => [
  "session-placement",
  placement.contractVersion,
  sessionIdentityTuple(placement.session),
  executionTargetTuple(placement.target),
  filesystemAuthorityTuple(placement.filesystem),
  controllerRefTuple(placement.controller),
];
export const sessionPlacementKey = keyFor(sessionPlacementTuple);
export const sessionPlacementEquals = equalsFor(sessionPlacementKey);

export const sessionIdentityBelongsToPlacement = (
  identity: SessionIdentity,
  placement: SessionPlacement,
): boolean => sessionIdentityEquals(identity, placement.session);

export const canonicalSessionCapabilityEntries = (
  entries: ReadonlyArray<SessionCapabilityStatus>,
): ReadonlyArray<SessionCapabilityStatus> =>
  [...entries].sort((a, b) =>
    a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0,
  );

export const sessionCapabilitiesKey = (capabilities: SessionCapabilities): string =>
  JSON.stringify([
    "session-capabilities",
    capabilities.contractVersion,
    canonicalSessionCapabilityEntries(capabilities.entries).map((entry) => [
      entry.capability,
      entry.available,
      entry.unavailableReason,
    ]),
  ]);

export type SessionIdentityContractVersion = typeof SessionIdentityContractVersionSchema.Type;
export type EnvironmentRef = typeof EnvironmentRefSchema.Type;
export type ExecutionTarget = typeof ExecutionTargetSchema.Type;
export type FilesystemAuthority = typeof FilesystemAuthoritySchema.Type;
export type ControllerRef = typeof ControllerRefSchema.Type;
export type SessionRuntimeKind = typeof SessionRuntimeKindSchema.Type;
export type RuntimeRef = typeof RuntimeRefSchema.Type;
export type SessionIdentity = typeof SessionIdentitySchema.Type;
export type SessionRevision = typeof SessionRevisionSchema.Type;
export type SessionArchiveState = typeof SessionArchiveStateSchema.Type;
export type SessionCoreCapability = (typeof SESSION_CORE_CAPABILITIES)[number];
export type SessionCapabilityName = typeof SessionCapabilityNameSchema.Type;
export type SessionCapabilityStatus = typeof SessionCapabilityStatusSchema.Type;
export type SessionCapabilities = typeof SessionCapabilitiesSchema.Type;
export type SessionPlacement = typeof SessionPlacementSchema.Type;
export type SessionKeyTuple = ReadonlyArray<string | number | boolean | null | SessionKeyTuple>;
