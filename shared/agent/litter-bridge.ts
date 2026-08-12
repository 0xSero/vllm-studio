import { Schema } from "effect";

export const LITTER_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const LITTER_BRIDGE_CAPABILITIES = [
  "stats.read",
  "models.control",
  "sessions.read",
  "sessions.write",
  "agent.turn",
  "realtime.session",
] as const;
export const LITTER_BRIDGE_REALTIME_CONTRACT_VERSION = 1 as const;

export const LitterBridgeParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strict = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  Schema.annotate<S>({ parseOptions: LitterBridgeParseOptions })(schema);
const struct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).pipe(strict);
const protocol = <const Type extends string, const Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) =>
  struct({
    type: Schema.Literal(type),
    protocolVersion: LitterBridgeProtocolVersionSchema,
    ...fields,
  });
const NonNegativeIntegerSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PositiveIntegerSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));
const NonNegativeNumberSchema = Schema.Finite.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const PercentageSchema = Schema.Finite.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
);
const IdentifierSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMaxLength(512)),
);
const ShortTextSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4_096)));
const WireTextSchema = Schema.String.pipe(Schema.check(Schema.isMaxLength(4_000_000)));
const JsonTextSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(1_000_000),
    Schema.makeFilter<string>((input) => {
      try {
        JSON.parse(input);
        return undefined;
      } catch {
        return "Expected bounded JSON text";
      }
    }),
  ),
);
const OpaqueTokenSchema = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isTrimmed(), Schema.isMaxLength(2_048)),
);
const TimestampSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)),
);
const NonceSchema = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLengthBetween(16, 512),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
);
const SignatureSchema = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed(),
    Schema.isLengthBetween(43, 512),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
);
const Sha256Schema = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

export const LitterBridgeProtocolVersionSchema = Schema.Literal(LITTER_BRIDGE_PROTOCOL_VERSION);
export const LitterBridgeCapabilitySchema = Schema.Literals(LITTER_BRIDGE_CAPABILITIES);
export const LitterBridgeRevisionSchema = NonNegativeIntegerSchema;
export const LitterBridgeTimestampSchema = TimestampSchema;
export const LitterBridgeContentHashSchema = Sha256Schema;

export const LitterBridgeDeviceAuthSchema = struct({
  deviceId: IdentifierSchema,
  keyId: IdentifierSchema,
  algorithm: Schema.Literal("ed25519"),
});

const RequestAuthFields = {
  device: LitterBridgeDeviceAuthSchema,
  requestId: IdentifierSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  nonce: NonceSchema,
  bodyHash: Sha256Schema,
  signature: SignatureSchema,
};

export const LitterBridgeRequestAuthSchema = struct({
  ...RequestAuthFields,
  capability: LitterBridgeCapabilitySchema,
});

export const LitterBridgeMutationAuthSchema = struct({
  ...RequestAuthFields,
  capability: LitterBridgeCapabilitySchema,
  idempotencyKey: IdentifierSchema,
});

const StatsReadAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("stats.read"),
});
const ModelsControlAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("models.control"),
  idempotencyKey: IdentifierSchema,
});
const SessionsReadAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("sessions.read"),
});
const SessionsWriteAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("sessions.write"),
  idempotencyKey: IdentifierSchema,
});
const AgentTurnAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("agent.turn"),
  idempotencyKey: IdentifierSchema,
});
const RealtimeSessionReadAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("realtime.session"),
});
const RealtimeSessionMutationAuthSchema = struct({
  ...RequestAuthFields,
  capability: Schema.Literal("realtime.session"),
  idempotencyKey: IdentifierSchema,
});

export const LitterBridgeSectionNameSchema = Schema.Literals([
  "health",
  "status",
  "gpus",
  "metrics",
  "agent-runtime",
]);

export const LitterBridgeErrorCodeSchema = Schema.Literals([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "expired_request",
  "replay_detected",
  "unsupported_version",
  "capability_denied",
  "not_found",
  "revision_conflict",
  "rate_limited",
  "payload_too_large",
  "integrity_failed",
  "controller_unavailable",
  "section_unavailable",
  "agent_runtime_unavailable",
  "realtime_unavailable",
  "realtime_session_expired",
  "realtime_state_conflict",
  "internal",
]);

export const LitterBridgeErrorDetailsSchema = struct({
  field: Schema.NullOr(IdentifierSchema),
  section: Schema.NullOr(LitterBridgeSectionNameSchema),
  expectedRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  currentRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  retryAfterMs: Schema.NullOr(NonNegativeIntegerSchema),
  limitBytes: Schema.NullOr(NonNegativeIntegerSchema),
});

export const LitterBridgeErrorSchema = struct({
  code: LitterBridgeErrorCodeSchema,
  message: ShortTextSchema,
  retriable: Schema.Boolean,
  requestId: Schema.NullOr(IdentifierSchema),
  details: Schema.NullOr(LitterBridgeErrorDetailsSchema),
});

export const LitterBridgeErrorResultSchema = protocol("error", {
  requestId: IdentifierSchema,
  error: LitterBridgeErrorSchema,
});

export const LitterBridgeFreshnessSchema = struct({
  observedAt: Schema.NullOr(TimestampSchema),
  ageMs: Schema.NullOr(NonNegativeIntegerSchema),
  maxAgeMs: NonNegativeIntegerSchema,
  stale: Schema.Boolean,
  sourceRevision: Schema.NullOr(LitterBridgeRevisionSchema),
});

const sectionSchema = <S extends Schema.Constraint>(value: S) =>
  struct({
    value: Schema.NullOr(value),
    error: Schema.NullOr(LitterBridgeErrorSchema),
    freshness: LitterBridgeFreshnessSchema,
  });

export const LitterBridgeControllerHealthSchema = struct({
  state: Schema.Literals(["ok", "degraded", "unavailable"]),
  reachable: Schema.Boolean,
  checkedAt: TimestampSchema,
  latencyMs: Schema.NullOr(NonNegativeNumberSchema),
  controllerVersion: Schema.NullOr(IdentifierSchema),
});

export const LitterBridgeControllerStatusSchema = struct({
  running: Schema.Boolean,
  inferencePort: Schema.NullOr(PositiveIntegerSchema),
  launchingRecipeId: Schema.NullOr(IdentifierSchema),
  activeLaunchId: Schema.NullOr(IdentifierSchema),
  activeModelIds: Schema.Array(IdentifierSchema),
});

export const LitterBridgeGpuDeviceSchema = struct({
  id: IdentifierSchema,
  index: NonNegativeIntegerSchema,
  name: IdentifierSchema,
  memoryTotalBytes: NonNegativeIntegerSchema,
  memoryUsedBytes: Schema.NullOr(NonNegativeIntegerSchema),
  memoryFreeBytes: Schema.NullOr(NonNegativeIntegerSchema),
  utilizationPercent: Schema.NullOr(PercentageSchema),
  temperatureCelsius: Schema.NullOr(Schema.Finite),
  powerWatts: Schema.NullOr(NonNegativeNumberSchema),
});

export const LitterBridgeGpuSnapshotSchema = struct({
  count: NonNegativeIntegerSchema,
  devices: Schema.Array(LitterBridgeGpuDeviceSchema),
});

export const LitterBridgeMetricsSchema = struct({
  requestsActive: Schema.NullOr(NonNegativeIntegerSchema),
  requestsQueued: Schema.NullOr(NonNegativeIntegerSchema),
  promptTokensPerSecond: Schema.NullOr(NonNegativeNumberSchema),
  generationTokensPerSecond: Schema.NullOr(NonNegativeNumberSchema),
  timeToFirstTokenMs: Schema.NullOr(NonNegativeNumberSchema),
  cacheUsagePercent: Schema.NullOr(PercentageSchema),
});

export const LitterBridgeAgentRuntimeStatsSchema = struct({
  state: Schema.Literals(["ok", "degraded", "unavailable"]),
  reachable: Schema.Boolean,
  runningSessionCount: NonNegativeIntegerSchema,
  activeTurnCount: NonNegativeIntegerSchema,
  persistedSessionCount: Schema.NullOr(NonNegativeIntegerSchema),
  eventSequence: Schema.NullOr(NonNegativeIntegerSchema),
});

export const LitterBridgeControllerSnapshotSchema = protocol("controller_snapshot", {
  snapshotId: IdentifierSchema,
  controllerId: IdentifierSchema,
  displayName: IdentifierSchema,
  generatedAt: TimestampSchema,
  revision: LitterBridgeRevisionSchema,
  state: Schema.Literals(["healthy", "degraded", "unavailable"]),
  capabilities: Schema.Array(LitterBridgeCapabilitySchema).pipe(Schema.check(Schema.isUnique())),
  sections: struct({
    health: sectionSchema(LitterBridgeControllerHealthSchema),
    status: sectionSchema(LitterBridgeControllerStatusSchema),
    gpus: sectionSchema(LitterBridgeGpuSnapshotSchema),
    metrics: sectionSchema(LitterBridgeMetricsSchema),
    agentRuntime: sectionSchema(LitterBridgeAgentRuntimeStatsSchema),
  }),
});

export const LitterBridgeCapabilitiesManifestSchema = protocol("capabilities", {
  bridgeId: IdentifierSchema,
  controllerId: IdentifierSchema,
  issuedAt: TimestampSchema,
  capabilities: Schema.Array(LitterBridgeCapabilitySchema).pipe(Schema.check(Schema.isUnique())),
});

export const LitterBridgeRealtimeContractVersionSchema = Schema.Literal(
  LITTER_BRIDGE_REALTIME_CONTRACT_VERSION,
);
export const LitterBridgeRealtimeProviderSchema = Schema.Literals([
  "provider_native",
  "local_pipeline",
]);
export const LitterBridgeRealtimeModalitySchema = Schema.Literals(["audio", "text"]);
export const LitterBridgeRealtimeSignalingSchema = Schema.Literals([
  "webrtc_offer_answer",
  "local_websocket",
]);
export const LitterBridgeRealtimeSessionStateSchema = Schema.Literals([
  "creating",
  "negotiating",
  "active",
  "reconnecting",
  "closing",
  "closed",
  "expired",
  "failed",
]);
export const LitterBridgeRealtimeUnavailableReasonSchema = Schema.Literals([
  "provider_not_configured",
  "model_not_loaded",
  "model_unsupported",
  "speech_plugin_unavailable",
  "runtime_unavailable",
]);

export const LitterBridgeRealtimeVoiceSchema = struct({
  id: IdentifierSchema,
  label: IdentifierSchema,
});

export const LitterBridgeRealtimeCapabilitySchema = Schema.Struct({
  capabilityId: IdentifierSchema,
  provider: LitterBridgeRealtimeProviderSchema,
  modelId: IdentifierSchema,
  available: Schema.Boolean,
  unavailableReason: Schema.NullOr(LitterBridgeRealtimeUnavailableReasonSchema),
  inputModalities: Schema.Array(LitterBridgeRealtimeModalitySchema).pipe(
    Schema.check(Schema.isUnique()),
  ),
  outputModalities: Schema.Array(LitterBridgeRealtimeModalitySchema).pipe(
    Schema.check(Schema.isUnique()),
  ),
  signaling: LitterBridgeRealtimeSignalingSchema,
  voices: Schema.Array(LitterBridgeRealtimeVoiceSchema),
  supportsReconnect: Schema.Boolean,
  supportsUpdate: Schema.Boolean,
  sessionTtlSeconds: PositiveIntegerSchema,
  maxSignalBytes: PositiveIntegerSchema,
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

export const LitterBridgeRealtimeCapabilitiesRequestSchema = protocol(
  "realtime_capabilities_request",
  {
    auth: RealtimeSessionReadAuthSchema,
    controllerId: IdentifierSchema,
    acceptedContractVersions: Schema.Array(LitterBridgeRealtimeContractVersionSchema).pipe(
      Schema.check(Schema.isNonEmpty()),
      Schema.check(Schema.isUnique()),
    ),
  },
);

export const LitterBridgeRealtimeCapabilitiesResultSchema = protocol("realtime_capabilities", {
  contractVersion: LitterBridgeRealtimeContractVersionSchema,
  requestId: IdentifierSchema,
  controllerId: IdentifierSchema,
  generatedAt: TimestampSchema,
  capabilities: Schema.Array(LitterBridgeRealtimeCapabilitySchema),
});

export const LitterBridgeRealtimeOfferSchema = struct({
  type: Schema.Literal("webrtc_offer"),
  sdp: WireTextSchema,
});

export const LitterBridgeRealtimeAnswerSchema = struct({
  type: Schema.Literal("webrtc_answer"),
  sdp: WireTextSchema,
});

export const LitterBridgeRealtimeSessionSchema = struct({
  sessionId: IdentifierSchema,
  clientSessionId: IdentifierSchema,
  capabilityId: IdentifierSchema,
  deviceId: IdentifierSchema,
  state: LitterBridgeRealtimeSessionStateSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  reconnectToken: Schema.NullOr(OpaqueTokenSchema),
});

export const LitterBridgeRealtimeSessionCreateRequestSchema = protocol(
  "realtime_session_create_request",
  {
    contractVersion: LitterBridgeRealtimeContractVersionSchema,
    auth: RealtimeSessionMutationAuthSchema,
    controllerId: IdentifierSchema,
    clientSessionId: IdentifierSchema,
    capabilityId: IdentifierSchema,
    voiceId: Schema.NullOr(IdentifierSchema),
    offer: LitterBridgeRealtimeOfferSchema,
  },
);

export const LitterBridgeRealtimeSessionCreateResultSchema = protocol("realtime_session_created", {
  contractVersion: LitterBridgeRealtimeContractVersionSchema,
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  session: LitterBridgeRealtimeSessionSchema,
  answer: LitterBridgeRealtimeAnswerSchema,
  brokerLatencyMs: NonNegativeNumberSchema,
});

export const LitterBridgeRealtimeSignalSchema = Schema.Union([
  struct({
    type: Schema.Literal("ice_candidate"),
    candidate: WireTextSchema,
    sdpMid: Schema.NullOr(IdentifierSchema),
    sdpMLineIndex: Schema.NullOr(NonNegativeIntegerSchema),
  }),
  struct({
    type: Schema.Literal("ice_complete"),
  }),
]).pipe(strict);

export const LitterBridgeRealtimeSignalRequestSchema = protocol("realtime_signal_request", {
  contractVersion: LitterBridgeRealtimeContractVersionSchema,
  auth: RealtimeSessionMutationAuthSchema,
  sessionId: IdentifierSchema,
  signal: LitterBridgeRealtimeSignalSchema,
});

export const LitterBridgeRealtimeSessionUpdateRequestSchema = protocol(
  "realtime_session_update_request",
  {
    contractVersion: LitterBridgeRealtimeContractVersionSchema,
    auth: RealtimeSessionMutationAuthSchema,
    sessionId: IdentifierSchema,
    voiceId: Schema.NullOr(IdentifierSchema),
    instructions: Schema.NullOr(ShortTextSchema),
  },
);

export const LitterBridgeRealtimeSessionCloseRequestSchema = protocol(
  "realtime_session_close_request",
  {
    contractVersion: LitterBridgeRealtimeContractVersionSchema,
    auth: RealtimeSessionMutationAuthSchema,
    sessionId: IdentifierSchema,
    reason: Schema.Literals(["user", "handoff", "timeout", "shutdown"]),
  },
);

export const LitterBridgeRealtimeSessionStatusSchema = protocol("realtime_session_status", {
  contractVersion: LitterBridgeRealtimeContractVersionSchema,
  eventId: IdentifierSchema,
  sequence: NonNegativeIntegerSchema,
  observedAt: TimestampSchema,
  session: LitterBridgeRealtimeSessionSchema,
  brokerLatencyMs: Schema.NullOr(NonNegativeNumberSchema),
  mediaConnectionLatencyMs: Schema.NullOr(NonNegativeNumberSchema),
  error: Schema.NullOr(LitterBridgeErrorSchema),
});

export const LitterBridgeRealtimeMutationAckSchema = protocol("realtime_mutation_ack", {
  contractVersion: LitterBridgeRealtimeContractVersionSchema,
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  session: LitterBridgeRealtimeSessionSchema,
});

export const LitterBridgeRealtimeRequestSchema = Schema.Union([
  LitterBridgeRealtimeCapabilitiesRequestSchema,
  LitterBridgeRealtimeSessionCreateRequestSchema,
  LitterBridgeRealtimeSignalRequestSchema,
  LitterBridgeRealtimeSessionUpdateRequestSchema,
  LitterBridgeRealtimeSessionCloseRequestSchema,
]).pipe(strict);

export const LitterBridgeRealtimeResultSchema = Schema.Union([
  LitterBridgeRealtimeCapabilitiesResultSchema,
  LitterBridgeRealtimeSessionCreateResultSchema,
  LitterBridgeRealtimeSessionStatusSchema,
  LitterBridgeRealtimeMutationAckSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeControllerSnapshotRequestSchema = protocol("controller_snapshot_request", {
  auth: StatsReadAuthSchema,
  controllerId: IdentifierSchema,
});

export const LitterBridgeControllerActionSchema = Schema.Union([
  struct({
    type: Schema.Literal("start_recipe"),
    recipeId: IdentifierSchema,
  }),
  struct({
    type: Schema.Literal("cancel_launch"),
    launchId: IdentifierSchema,
  }),
  struct({
    type: Schema.Literal("evict_model"),
    modelId: IdentifierSchema,
  }),
]).pipe(strict);

export const LitterBridgeControllerActionRequestSchema = protocol("controller_action_request", {
  auth: ModelsControlAuthSchema,
  controllerId: IdentifierSchema,
  expectedRevision: LitterBridgeRevisionSchema,
  action: LitterBridgeControllerActionSchema,
});

export const LitterBridgeSessionAuthoritySchema = Schema.Literals(["local-studio", "litter"]);

export const LitterBridgeExternalSessionIdentitySchema = struct({
  kind: Schema.Literal("external_session"),
  authority: LitterBridgeSessionAuthoritySchema,
  installationId: IdentifierSchema,
  sessionId: IdentifierSchema,
});

export const LitterBridgeSessionOriginSchema = struct({
  application: LitterBridgeSessionAuthoritySchema,
  installationId: IdentifierSchema,
  deviceId: Schema.NullOr(IdentifierSchema),
  exportedAt: TimestampSchema,
});

export const LitterBridgeSessionMetadataSchema = struct({
  title: Schema.NullOr(ShortTextSchema),
  cwd: Schema.NullOr(IdentifierSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  modelId: Schema.NullOr(IdentifierSchema),
  providerId: Schema.NullOr(IdentifierSchema),
});

export const LitterBridgeSessionListCursorSchema = struct({
  type: Schema.Literal("session_list_cursor"),
  token: OpaqueTokenSchema,
  revision: LitterBridgeRevisionSchema,
  hasMore: Schema.Boolean,
});

export const LitterBridgeSessionDescriptorSchema = struct({
  session: LitterBridgeExternalSessionIdentitySchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  archived: Schema.Boolean,
  active: Schema.Boolean,
});

export const LitterBridgeMessageRoleSchema = Schema.Literals([
  "system",
  "user",
  "assistant",
  "tool",
]);

export const LitterBridgeMessagePartSchema = Schema.Union([
  struct({
    type: Schema.Literal("text"),
    text: WireTextSchema,
  }),
  struct({
    type: Schema.Literal("reasoning"),
    text: WireTextSchema,
  }),
  struct({
    type: Schema.Literal("tool_ref"),
    toolCallId: IdentifierSchema,
  }),
  struct({
    type: Schema.Literal("attachment_ref"),
    attachmentId: IdentifierSchema,
  }),
]).pipe(strict);

export const LitterBridgeMessageDescriptorSchema = struct({
  messageId: IdentifierSchema,
  parentMessageId: Schema.NullOr(IdentifierSchema),
  sequence: NonNegativeIntegerSchema,
  role: LitterBridgeMessageRoleSchema,
  createdAt: TimestampSchema,
  editedAt: Schema.NullOr(TimestampSchema),
  parts: Schema.Array(LitterBridgeMessagePartSchema),
  contentHash: Sha256Schema,
});

export const LitterBridgeToolDescriptorSchema = struct({
  toolCallId: IdentifierSchema,
  messageId: IdentifierSchema,
  name: IdentifierSchema,
  state: Schema.Literals(["requested", "running", "completed", "failed", "cancelled"]),
  argumentsJson: JsonTextSchema,
  argumentsHash: Sha256Schema,
  resultJson: Schema.NullOr(JsonTextSchema),
  resultHash: Schema.NullOr(Sha256Schema),
  startedAt: Schema.NullOr(TimestampSchema),
  completedAt: Schema.NullOr(TimestampSchema),
});

export const LitterBridgeAttachmentDescriptorSchema = struct({
  attachmentId: IdentifierSchema,
  messageId: IdentifierSchema,
  fileName: IdentifierSchema,
  mediaType: IdentifierSchema,
  byteLength: NonNegativeIntegerSchema,
  contentHash: Sha256Schema,
  blobId: Schema.NullOr(IdentifierSchema),
  availability: Schema.Literals(["metadata_only", "available"]),
});

export const LitterBridgeHashReferenceSchema = struct({
  id: IdentifierSchema,
  sha256: Sha256Schema,
});

export const LitterBridgeContentHashesSchema = struct({
  algorithm: Schema.Literal("sha256"),
  session: Sha256Schema,
  messages: Schema.Array(LitterBridgeHashReferenceSchema),
  tools: Schema.Array(LitterBridgeHashReferenceSchema),
  attachments: Schema.Array(LitterBridgeHashReferenceSchema),
});

export const LitterBridgeTransferCursorSchema = struct({
  type: Schema.Literal("session_transfer_cursor"),
  token: OpaqueTokenSchema,
  revision: LitterBridgeRevisionSchema,
  afterSequence: NonNegativeIntegerSchema,
  hasMore: Schema.Boolean,
});

export const LitterBridgeSessionTransferEnvelopeSchema = protocol("session_transfer", {
  transferId: IdentifierSchema,
  auth: SessionsWriteAuthSchema,
  direction: Schema.Literals(["litter_to_local_studio", "local_studio_to_litter"]),
  mode: Schema.Literals(["snapshot", "delta"]),
  session: LitterBridgeExternalSessionIdentitySchema,
  origin: LitterBridgeSessionOriginSchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  baseRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  expectedRevision: Schema.NullOr(LitterBridgeRevisionSchema),
  messages: Schema.Array(LitterBridgeMessageDescriptorSchema),
  tools: Schema.Array(LitterBridgeToolDescriptorSchema),
  attachments: Schema.Array(LitterBridgeAttachmentDescriptorSchema),
  contentHashes: LitterBridgeContentHashesSchema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  conflictPolicy: Schema.Literals(["reject", "fork"]),
});

export const LitterBridgeSessionReadRequestSchema = protocol("session_read_request", {
  auth: SessionsReadAuthSchema,
  session: Schema.NullOr(LitterBridgeExternalSessionIdentitySchema),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  limit: PositiveIntegerSchema.pipe(Schema.check(Schema.isLessThanOrEqualTo(200))),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      (input.session === null) !== (input.cursor === null)
        ? undefined
        : "Provide a session for the first page or a cursor for continuation",
    ),
  ),
  strict,
);

export const LitterBridgeSessionListRequestSchema = protocol("session_list_request", {
  auth: SessionsReadAuthSchema,
  cursor: Schema.NullOr(LitterBridgeSessionListCursorSchema),
  limit: PositiveIntegerSchema.pipe(Schema.check(Schema.isLessThanOrEqualTo(200))),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.cursor === null || input.cursor.hasMore
        ? undefined
        : "Session list cursor must have more results",
    ),
  ),
  strict,
);

export const LitterBridgeSessionListPageSchema = protocol("session_list_page", {
  requestId: IdentifierSchema,
  controllerId: IdentifierSchema,
  revision: LitterBridgeRevisionSchema,
  sessions: Schema.Array(LitterBridgeSessionDescriptorSchema),
  cursor: Schema.NullOr(LitterBridgeSessionListCursorSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter((input) =>
      input.cursor === null || (input.cursor.hasMore && input.cursor.revision === input.revision)
        ? undefined
        : "Session list cursor must match the page revision",
    ),
  ),
  strict,
);

export const LitterBridgeSessionPageSchema = protocol("session_page", {
  requestId: IdentifierSchema,
  pageId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  origin: LitterBridgeSessionOriginSchema,
  metadata: LitterBridgeSessionMetadataSchema,
  revision: LitterBridgeRevisionSchema,
  messages: Schema.Array(LitterBridgeMessageDescriptorSchema),
  tools: Schema.Array(LitterBridgeToolDescriptorSchema),
  attachments: Schema.Array(LitterBridgeAttachmentDescriptorSchema),
  contentHashes: LitterBridgeContentHashesSchema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
});

export const LitterBridgeAgentTurnRequestSchema = protocol("agent_turn_request", {
  auth: AgentTurnAuthSchema,
  session: LitterBridgeExternalSessionIdentitySchema,
  expectedRevision: LitterBridgeRevisionSchema,
  messageId: IdentifierSchema,
  modelId: Schema.NullOr(IdentifierSchema),
  content: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(100_000))),
  contentHash: Sha256Schema,
});

export const LitterBridgeAgentTurnAckSchema = protocol("agent_turn_ack", {
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  dispatchId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  messageId: IdentifierSchema,
  contentHash: Sha256Schema,
  baseRevision: LitterBridgeRevisionSchema,
  piSessionId: IdentifierSchema,
  modelId: IdentifierSchema,
  outcome: Schema.Literal("accepted"),
  acceptedAt: TimestampSchema,
});

export const LitterBridgeTransferAckSchema = protocol("ack", {
  requestId: IdentifierSchema,
  transferId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  acceptedRevision: LitterBridgeRevisionSchema,
  appliedMessages: NonNegativeIntegerSchema,
  appliedTools: NonNegativeIntegerSchema,
  appliedAttachments: NonNegativeIntegerSchema,
  contentHash: Sha256Schema,
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  acknowledgedAt: TimestampSchema,
});

export const LitterBridgeConflictResultSchema = protocol("conflict", {
  requestId: IdentifierSchema,
  operation: Schema.Literals(["controller_action", "session_transfer", "agent_turn"]),
  expectedRevision: LitterBridgeRevisionSchema,
  currentRevision: LitterBridgeRevisionSchema,
  resolution: Schema.Literals(["retry", "fork_required", "manual"]),
  canonicalSession: Schema.NullOr(LitterBridgeExternalSessionIdentitySchema),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  error: LitterBridgeErrorSchema,
});

export const LitterBridgeForkResultSchema = protocol("fork", {
  requestId: IdentifierSchema,
  transferId: IdentifierSchema,
  sourceSession: LitterBridgeExternalSessionIdentitySchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  sourceRevision: LitterBridgeRevisionSchema,
  acceptedRevision: LitterBridgeRevisionSchema,
  reason: Schema.Literals(["revision_conflict", "identity_collision", "explicit"]),
  cursor: Schema.NullOr(LitterBridgeTransferCursorSchema),
  acknowledgedAt: TimestampSchema,
});

export const LitterBridgeSessionTransferResultSchema = Schema.Union([
  LitterBridgeTransferAckSchema,
  LitterBridgeConflictResultSchema,
  LitterBridgeForkResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeAgentTurnResultSchema = Schema.Union([
  LitterBridgeAgentTurnAckSchema,
  LitterBridgeConflictResultSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeSessionCreateRequestSchema = protocol("session_create_request", {
  auth: SessionsWriteAuthSchema,
  controllerId: IdentifierSchema,
  cwd: IdentifierSchema,
  modelId: Schema.NullOr(IdentifierSchema),
  title: Schema.NullOr(ShortTextSchema),
  messageId: IdentifierSchema,
  content: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(100_000))),
  contentHash: Sha256Schema,
});

export const LitterBridgeSessionCreateAckSchema = protocol("session_create_ack", {
  requestId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  dispatchId: IdentifierSchema,
  canonicalSession: LitterBridgeExternalSessionIdentitySchema,
  descriptor: LitterBridgeSessionDescriptorSchema,
  messageId: IdentifierSchema,
  contentHash: Sha256Schema,
  piSessionId: IdentifierSchema,
  modelId: IdentifierSchema,
  outcome: Schema.Literal("accepted"),
  acceptedAt: TimestampSchema,
});

export const LitterBridgeSessionCreateResultSchema = Schema.Union([
  LitterBridgeSessionCreateAckSchema,
  LitterBridgeErrorResultSchema,
]).pipe(strict);

export const LitterBridgeGatewayRequestSchema = Schema.Union([
  LitterBridgeControllerSnapshotRequestSchema,
  LitterBridgeSessionListRequestSchema,
  LitterBridgeSessionReadRequestSchema,
  LitterBridgeSessionCreateRequestSchema,
  LitterBridgeAgentTurnRequestSchema,
]).pipe(strict);

export const LitterBridgeRequestSchema = Schema.Union([
  LitterBridgeControllerSnapshotRequestSchema,
  LitterBridgeControllerActionRequestSchema,
  LitterBridgeSessionListRequestSchema,
  LitterBridgeSessionReadRequestSchema,
  LitterBridgeSessionTransferEnvelopeSchema,
  LitterBridgeSessionCreateRequestSchema,
  LitterBridgeAgentTurnRequestSchema,
]).pipe(strict);

export type LitterBridgeProtocolVersion = typeof LitterBridgeProtocolVersionSchema.Type;
export type LitterBridgeCapability = typeof LitterBridgeCapabilitySchema.Type;
export type LitterBridgeRevision = typeof LitterBridgeRevisionSchema.Type;
export type LitterBridgeDeviceAuth = typeof LitterBridgeDeviceAuthSchema.Type;
export type LitterBridgeRequestAuth = typeof LitterBridgeRequestAuthSchema.Type;
export type LitterBridgeMutationAuth = typeof LitterBridgeMutationAuthSchema.Type;
export type LitterBridgeSectionName = typeof LitterBridgeSectionNameSchema.Type;
export type LitterBridgeErrorCode = typeof LitterBridgeErrorCodeSchema.Type;
export type LitterBridgeErrorDetails = typeof LitterBridgeErrorDetailsSchema.Type;
export type LitterBridgeError = typeof LitterBridgeErrorSchema.Type;
export type LitterBridgeErrorResult = typeof LitterBridgeErrorResultSchema.Type;
export type LitterBridgeFreshness = typeof LitterBridgeFreshnessSchema.Type;
export type LitterBridgeControllerHealth = typeof LitterBridgeControllerHealthSchema.Type;
export type LitterBridgeControllerStatus = typeof LitterBridgeControllerStatusSchema.Type;
export type LitterBridgeGpuDevice = typeof LitterBridgeGpuDeviceSchema.Type;
export type LitterBridgeGpuSnapshot = typeof LitterBridgeGpuSnapshotSchema.Type;
export type LitterBridgeMetrics = typeof LitterBridgeMetricsSchema.Type;
export type LitterBridgeAgentRuntimeStats = typeof LitterBridgeAgentRuntimeStatsSchema.Type;
export type LitterBridgeControllerSnapshot = typeof LitterBridgeControllerSnapshotSchema.Type;
export type LitterBridgeCapabilitiesManifest = typeof LitterBridgeCapabilitiesManifestSchema.Type;
export type LitterBridgeRealtimeContractVersion =
  typeof LitterBridgeRealtimeContractVersionSchema.Type;
export type LitterBridgeRealtimeProvider = typeof LitterBridgeRealtimeProviderSchema.Type;
export type LitterBridgeRealtimeModality = typeof LitterBridgeRealtimeModalitySchema.Type;
export type LitterBridgeRealtimeSignaling = typeof LitterBridgeRealtimeSignalingSchema.Type;
export type LitterBridgeRealtimeSessionState = typeof LitterBridgeRealtimeSessionStateSchema.Type;
export type LitterBridgeRealtimeUnavailableReason =
  typeof LitterBridgeRealtimeUnavailableReasonSchema.Type;
export type LitterBridgeRealtimeVoice = typeof LitterBridgeRealtimeVoiceSchema.Type;
export type LitterBridgeRealtimeCapability = typeof LitterBridgeRealtimeCapabilitySchema.Type;
export type LitterBridgeRealtimeCapabilitiesRequest =
  typeof LitterBridgeRealtimeCapabilitiesRequestSchema.Type;
export type LitterBridgeRealtimeCapabilitiesResult =
  typeof LitterBridgeRealtimeCapabilitiesResultSchema.Type;
export type LitterBridgeRealtimeOffer = typeof LitterBridgeRealtimeOfferSchema.Type;
export type LitterBridgeRealtimeAnswer = typeof LitterBridgeRealtimeAnswerSchema.Type;
export type LitterBridgeRealtimeSession = typeof LitterBridgeRealtimeSessionSchema.Type;
export type LitterBridgeRealtimeSessionCreateRequest =
  typeof LitterBridgeRealtimeSessionCreateRequestSchema.Type;
export type LitterBridgeRealtimeSessionCreateResult =
  typeof LitterBridgeRealtimeSessionCreateResultSchema.Type;
export type LitterBridgeRealtimeSignal = typeof LitterBridgeRealtimeSignalSchema.Type;
export type LitterBridgeRealtimeSignalRequest = typeof LitterBridgeRealtimeSignalRequestSchema.Type;
export type LitterBridgeRealtimeSessionUpdateRequest =
  typeof LitterBridgeRealtimeSessionUpdateRequestSchema.Type;
export type LitterBridgeRealtimeSessionCloseRequest =
  typeof LitterBridgeRealtimeSessionCloseRequestSchema.Type;
export type LitterBridgeRealtimeSessionStatus = typeof LitterBridgeRealtimeSessionStatusSchema.Type;
export type LitterBridgeRealtimeMutationAck = typeof LitterBridgeRealtimeMutationAckSchema.Type;
export type LitterBridgeRealtimeRequest = typeof LitterBridgeRealtimeRequestSchema.Type;
export type LitterBridgeRealtimeResult = typeof LitterBridgeRealtimeResultSchema.Type;
export type LitterBridgeControllerSnapshotRequest =
  typeof LitterBridgeControllerSnapshotRequestSchema.Type;
export type LitterBridgeControllerAction = typeof LitterBridgeControllerActionSchema.Type;
export type LitterBridgeControllerActionRequest =
  typeof LitterBridgeControllerActionRequestSchema.Type;
export type LitterBridgeSessionAuthority = typeof LitterBridgeSessionAuthoritySchema.Type;
export type LitterBridgeExternalSessionIdentity =
  typeof LitterBridgeExternalSessionIdentitySchema.Type;
export type LitterBridgeSessionOrigin = typeof LitterBridgeSessionOriginSchema.Type;
export type LitterBridgeSessionMetadata = typeof LitterBridgeSessionMetadataSchema.Type;
export type LitterBridgeSessionListCursor = typeof LitterBridgeSessionListCursorSchema.Type;
export type LitterBridgeSessionDescriptor = typeof LitterBridgeSessionDescriptorSchema.Type;
export type LitterBridgeMessageRole = typeof LitterBridgeMessageRoleSchema.Type;
export type LitterBridgeMessagePart = typeof LitterBridgeMessagePartSchema.Type;
export type LitterBridgeMessageDescriptor = typeof LitterBridgeMessageDescriptorSchema.Type;
export type LitterBridgeToolDescriptor = typeof LitterBridgeToolDescriptorSchema.Type;
export type LitterBridgeAttachmentDescriptor = typeof LitterBridgeAttachmentDescriptorSchema.Type;
export type LitterBridgeHashReference = typeof LitterBridgeHashReferenceSchema.Type;
export type LitterBridgeContentHashes = typeof LitterBridgeContentHashesSchema.Type;
export type LitterBridgeTransferCursor = typeof LitterBridgeTransferCursorSchema.Type;
export type LitterBridgeSessionTransferEnvelope =
  typeof LitterBridgeSessionTransferEnvelopeSchema.Type;
export type LitterBridgeSessionReadRequest = typeof LitterBridgeSessionReadRequestSchema.Type;
export type LitterBridgeSessionListRequest = typeof LitterBridgeSessionListRequestSchema.Type;
export type LitterBridgeSessionListPage = typeof LitterBridgeSessionListPageSchema.Type;
export type LitterBridgeSessionPage = typeof LitterBridgeSessionPageSchema.Type;
export type LitterBridgeAgentTurnRequest = typeof LitterBridgeAgentTurnRequestSchema.Type;
export type LitterBridgeAgentTurnAck = typeof LitterBridgeAgentTurnAckSchema.Type;
export type LitterBridgeTransferAck = typeof LitterBridgeTransferAckSchema.Type;
export type LitterBridgeConflictResult = typeof LitterBridgeConflictResultSchema.Type;
export type LitterBridgeForkResult = typeof LitterBridgeForkResultSchema.Type;
export type LitterBridgeSessionTransferResult = typeof LitterBridgeSessionTransferResultSchema.Type;
export type LitterBridgeAgentTurnResult = typeof LitterBridgeAgentTurnResultSchema.Type;
export type LitterBridgeSessionCreateRequest = typeof LitterBridgeSessionCreateRequestSchema.Type;
export type LitterBridgeSessionCreateAck = typeof LitterBridgeSessionCreateAckSchema.Type;
export type LitterBridgeSessionCreateResult = typeof LitterBridgeSessionCreateResultSchema.Type;
export type LitterBridgeGatewayRequest = typeof LitterBridgeGatewayRequestSchema.Type;
export type LitterBridgeRequest = typeof LitterBridgeRequestSchema.Type;
