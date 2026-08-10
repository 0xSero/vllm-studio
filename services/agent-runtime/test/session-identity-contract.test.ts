import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Schema } from "effect";
import {
  canonicalSessionCapabilityEntries,
  ControllerRefSchema,
  controllerRefEquals,
  controllerRefKey,
  EnvironmentRefSchema,
  environmentRefKey,
  ExecutionTargetSchema,
  executionTargetKey,
  FilesystemAuthoritySchema,
  filesystemAuthorityBelongsToTarget,
  filesystemAuthorityKey,
  RuntimeRefSchema,
  SESSION_CORE_CAPABILITIES,
  SESSION_RUNTIME_KINDS,
  SessionArchiveStateSchema,
  SessionCapabilitiesSchema,
  sessionCapabilitiesKey,
  SessionCapabilityNameSchema,
  SessionCapabilityStatusSchema,
  SessionIdentityContractVersionSchema,
  SessionIdentitySchema,
  sessionIdentityBelongsToPlacement,
  sessionIdentityKey,
  SessionPlacementSchema,
  sessionPlacementKey,
  SessionRevisionSchema,
  SessionRuntimeKindSchema,
} from "../../../shared/agent/session-identity";

type Wire = Record<string, unknown>;
type WireSchema = Parameters<typeof Schema.decodeUnknownSync>[0] &
  Parameters<typeof Schema.encodeUnknownSync>[0];

const roundTrip = (schema: WireSchema, wire: unknown): unknown => {
  const decoded = Schema.decodeUnknownSync(schema)(wire);
  assert.deepEqual(Schema.encodeUnknownSync(schema)(decoded), wire);
  return decoded;
};
const rejects = (schema: WireSchema, wire: unknown): void => {
  assert.throws(() => Schema.decodeUnknownSync(schema)(wire));
};

const environment = (environmentId: string) => ({ contractVersion: 1 as const, environmentId });
const target = (targetId: string, environmentId: string) => ({
  contractVersion: 1 as const,
  targetId,
  environment: environment(environmentId),
});
const filesystem = (filesystemId: string, owner = target("tgt-a", "env-a")) => ({
  contractVersion: 1 as const,
  filesystemId,
  target: owner,
});
const controller = (controllerId: string) => ({ contractVersion: 1 as const, controllerId });
const runtime = (kind: (typeof SESSION_RUNTIME_KINDS)[number], runtimeId: string) => ({
  contractVersion: 1 as const,
  kind,
  runtimeId,
});
const identity = (
  sessionId: string,
  owner = runtime("pi", "pi-a"),
  home = environment("env-a"),
) => ({ contractVersion: 1 as const, sessionId, runtime: owner, environment: home });
const placement = (overrides: Wire = {}) => ({
  contractVersion: 1 as const,
  session: identity("sess-a"),
  target: target("tgt-a", "env-a"),
  filesystem: filesystem("fs-a"),
  controller: controller("ctl-a"),
  ...overrides,
});
const entry = (capability: string, available: boolean, unavailableReason: string | null) => ({
  capability,
  available,
  unavailableReason,
});
const coreEntries = () => SESSION_CORE_CAPABILITIES.map((name) => entry(name, true, null));
const capabilitySet = (entries: ReadonlyArray<Wire>) => ({ contractVersion: 1 as const, entries });

const structVectors: ReadonlyArray<readonly [WireSchema, Wire]> = [
  [EnvironmentRefSchema, environment("env-a")],
  [ExecutionTargetSchema, target("tgt-a", "env-a")],
  [FilesystemAuthoritySchema, filesystem("fs-a")],
  [ControllerRefSchema, controller("ctl-a")],
  [RuntimeRefSchema, runtime("codex", "codex-a")],
  [SessionIdentitySchema, identity("sess-a")],
  [SessionCapabilitiesSchema, capabilitySet(coreEntries())],
  [SessionPlacementSchema, placement()],
];

describe("session identity contract", () => {
  test("decodes and re-encodes every exported schema", () => {
    for (const [schema, wire] of structVectors) roundTrip(schema, wire);
    roundTrip(SessionIdentityContractVersionSchema, 1);
    roundTrip(SessionRuntimeKindSchema, "chatgpt");
    roundTrip(SessionRevisionSchema, 7);
    roundTrip(SessionArchiveStateSchema, "archived");
    roundTrip(SessionCapabilityNameSchema, "session.turn");
    roundTrip(SessionCapabilityStatusSchema, entry("session.turn", false, "runtime offline"));
    roundTrip(
      SessionCapabilitiesSchema,
      capabilitySet([
        entry("vendor.custom_capability", false, "not provided by this runtime"),
        ...[...coreEntries()].reverse(),
        entry("session.import", false, "no authorized import source is represented"),
      ]),
    );
  });

  test("enforces trimmed identifiers at the 512 UTF-16 code unit boundary", () => {
    for (const bad of ["", "   ", " padded ", "a".repeat(513), "😀".repeat(257)]) {
      rejects(EnvironmentRefSchema, environment(bad));
    }
    for (const ok of ["a".repeat(512), "😀".repeat(256)]) {
      roundTrip(EnvironmentRefSchema, environment(ok));
    }
    rejects(RuntimeRefSchema, { ...runtime("pi", "pi-a"), runtimeId: "   " });
  });

  test("rejects wrong versions, unknown literals, and excess properties", () => {
    for (const [schema, wire] of structVectors) {
      rejects(schema, { ...wire, contractVersion: 2 });
      rejects(schema, { ...wire, excess: "rejected" });
    }
    rejects(SessionIdentityContractVersionSchema, 2);
    rejects(SessionRuntimeKindSchema, "gemini");
    rejects(SessionArchiveStateSchema, "deleted");
    rejects(SessionCapabilityNameSchema, "list");
    rejects(SessionPlacementSchema, placement({ session: { ...identity("sess-a"), excess: "x" } }));
    rejects(SessionPlacementSchema, placement({ runtime: runtime("pi", "pi-a") }));
  });

  test("keeps controller references free of serving, pairing, and secret fields", () => {
    const fields = ["endpoint", "url", "apiKey", "token", "pairingSecret", "modelName"];
    for (const field of [...fields, "nodeId", "instanceId", "visionPairing"]) {
      rejects(ControllerRefSchema, { ...controller("ctl-a"), [field]: "rejected-field" });
    }
  });

  test("builds collision-proof case-preserving keys for hostile identifiers", () => {
    const splits: ReadonlyArray<readonly [string, string, string, string]> = [
      ['a","b', "c", "a", '","bc'],
      ["a/b", "c", "a", "/bc"],
      ["a|b", "c", "a", "|bc"],
      ["a\\", "b", "a", "\\b"],
      ['{"x":1}', "[2],", '{"x":1}[', "2],"],
      ["😀セッション", "b", "😀", "セッションb"],
    ];
    for (const [leftId, leftEnv, rightId, rightEnv] of splits) {
      const left = executionTargetKey(target(leftId, leftEnv));
      assert.notEqual(left, executionTargetKey(target(rightId, rightEnv)));
      assert.equal(left, executionTargetKey(target(leftId, leftEnv)));
    }
    assert.notEqual(executionTargetKey(target("x", "y")), executionTargetKey(target("y", "x")));
    assert.notEqual(
      environmentRefKey(environment("Case-A")),
      environmentRefKey(environment("case-a")),
    );
    assert.notEqual(
      environmentRefKey(environment("shared-id")),
      controllerRefKey(controller("shared-id")),
    );
    assert.notEqual(
      filesystemAuthorityKey(filesystem('fs","x', target("t", "e"))),
      filesystemAuthorityKey(filesystem("fs", target('","x-t', "e"))),
    );
  });

  test("keeps identical raw ids distinct across runtime, environment, and filesystem", () => {
    const keys = new Set(
      SESSION_RUNTIME_KINDS.map((kind) =>
        sessionIdentityKey(identity("thread-1", runtime(kind, "rt-a"))),
      ),
    );
    assert.equal(keys.size, SESSION_RUNTIME_KINDS.length);
    assert.notEqual(
      sessionIdentityKey(identity("thread-1", runtime("pi", "rt-a"))),
      sessionIdentityKey(identity("thread-1", runtime("pi", "rt-b"))),
    );
    assert.notEqual(
      sessionIdentityKey(identity("thread-1", runtime("pi", "rt-a"), environment("env-a"))),
      sessionIdentityKey(identity("thread-1", runtime("pi", "rt-a"), environment("env-b"))),
    );
    const owner = target("tgt-a", "env-a");
    assert.notEqual(
      filesystemAuthorityKey(filesystem("fs-a", owner)),
      filesystemAuthorityKey(filesystem("fs-b", owner)),
    );
    assert.equal(executionTargetKey(owner), executionTargetKey(target("tgt-a", "env-a")));
  });

  test("binds placement to one filesystem target and one session environment", () => {
    const wrongTarget = filesystem("fs-a", target("tgt-b", "env-a"));
    const wrongEnvironment = filesystem("fs-a", target("tgt-a", "env-b"));
    const strayIdentity = identity("sess-a", runtime("pi", "pi-a"), environment("env-b"));
    rejects(SessionPlacementSchema, placement({ filesystem: wrongTarget }));
    rejects(SessionPlacementSchema, placement({ filesystem: wrongEnvironment }));
    rejects(SessionPlacementSchema, placement({ session: strayIdentity }));
  });

  test("keeps controller identity independent of target and filesystem authority", () => {
    const remoteTarget = target("tgt-b", "env-b");
    const local = Schema.decodeUnknownSync(SessionPlacementSchema)(placement());
    const remote = Schema.decodeUnknownSync(SessionPlacementSchema)(
      placement({
        session: identity("sess-a", runtime("pi", "pi-a"), environment("env-b")),
        target: remoteTarget,
        filesystem: filesystem("fs-b", remoteTarget),
      }),
    );
    assert.equal(controllerRefKey(local.controller), controllerRefKey(remote.controller));
    assert.equal(controllerRefEquals(local.controller, remote.controller), true);
    assert.notEqual(sessionPlacementKey(local), sessionPlacementKey(remote));
    assert.equal(filesystemAuthorityBelongsToTarget(local.filesystem, local.target), true);
    assert.equal(filesystemAuthorityBelongsToTarget(remote.filesystem, local.target), false);
    assert.equal(sessionIdentityBelongsToPlacement(local.session, local), true);
    assert.equal(sessionIdentityBelongsToPlacement(remote.session, local), false);
  });

  test("represents chatgpt as provenance without advertising unsupported control", () => {
    const ref = Schema.decodeUnknownSync(RuntimeRefSchema)(runtime("chatgpt", "chatgpt-a"));
    assert.equal(ref.kind, "chatgpt");
    const wire = capabilitySet([
      ...SESSION_CORE_CAPABILITIES.map((name) =>
        entry(name, false, "chatgpt identity is provenance only in contract version 1"),
      ),
      entry("session.import", false, "no authorized import source is represented"),
    ]);
    const decoded = Schema.decodeUnknownSync(SessionCapabilitiesSchema)(wire);
    assert.equal(
      decoded.entries.every((status) => status.available === false),
      true,
    );
    const importEntry = decoded.entries.find((status) => status.capability === "session.import");
    assert.equal(importEntry?.available, false);
    assert.equal(typeof importEntry?.unavailableReason, "string");
    assert.deepEqual(Schema.encodeUnknownSync(SessionCapabilitiesSchema)(decoded), wire);
  });

  test("orders capabilities canonically without weakening or mutating input", () => {
    const scrambledWire = capabilitySet([...coreEntries()].reverse());
    const scrambledCopy = structuredClone(scrambledWire);
    const scrambled = Schema.decodeUnknownSync(SessionCapabilitiesSchema)(scrambledWire);
    const ordered = Schema.decodeUnknownSync(SessionCapabilitiesSchema)(
      capabilitySet(coreEntries()),
    );
    assert.deepEqual(
      canonicalSessionCapabilityEntries(scrambled.entries),
      canonicalSessionCapabilityEntries(ordered.entries),
    );
    assert.equal(sessionCapabilitiesKey(scrambled), sessionCapabilitiesKey(ordered));
    assert.notEqual(scrambled.entries[0]?.capability, ordered.entries[0]?.capability);
    assert.deepEqual(scrambledWire, scrambledCopy);
    const placementWire = placement();
    const placementCopy = structuredClone(placementWire);
    sessionPlacementKey(Schema.decodeUnknownSync(SessionPlacementSchema)(placementWire));
    assert.deepEqual(placementWire, placementCopy);
    rejects(SessionCapabilitiesSchema, capabilitySet(coreEntries().slice(1)));
    rejects(
      SessionCapabilitiesSchema,
      capabilitySet([...coreEntries(), entry("session.list", true, null)]),
    );
    rejects(SessionCapabilityStatusSchema, entry("session.turn", true, "reason must be null"));
    rejects(SessionCapabilityStatusSchema, entry("session.turn", false, null));
    rejects(SessionCapabilityStatusSchema, entry("session.turn", false, "   "));
  });

  test("keeps fixtures free of private paths, secrets, and live identifiers", () => {
    const blob = JSON.stringify([
      structVectors.map(([, wire]) => wire),
      runtime("chatgpt", "chatgpt-a"),
      coreEntries(),
    ]);
    const forbidden = [
      /\/(Users|home|private|var)\//,
      /\b\d{1,3}(\.\d{1,3}){3}\b/,
      /\.ts\.net/i,
      /sk-|ghp_|bearer /i,
    ];
    for (const pattern of forbidden) {
      assert.equal(pattern.test(blob), false);
    }
  });
});
