import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import type { TensorPrimeConnectionProfile } from "@local-studio/contracts/tensorprime";
import {
  loadTensorPrimeConnectionProfile,
  tensorPrimeSvidReadinessEvidence,
  validateTensorPrimeWorkloadBinding,
} from "../src/tensorprime-profile";

const profilePath = resolve(
  import.meta.dirname,
  "../../../deploy/spire/tensorprime-connection-profile.json",
);

test("loads the complete TensorPrime Phase-0 service catalog", () => {
  const profile = loadTensorPrimeConnectionProfile(profilePath);
  assert.ok(profile);
  assert.equal(profile.trust_domain, "tprime.vlans.ca");
  assert.equal(profile.workload_api.endpoint, "unix:///run/spiffe/workload/spire-agent.sock");
  assert.deepEqual(
    new Set(profile.services.map(({ kind }) => kind)),
    new Set([
      "ray-client",
      "ray-dashboard",
      "ray-serve",
      "vllm",
      "litellm",
      "embedding-http",
      "embedding-grpc",
      "asr",
      "unified-api",
    ]),
  );
  assert.ok(profile.services.every((service) => service.server_mtls_enforced === false));
  assert.ok(profile.services.every((service) => service.transport_security === "plaintext"));
});

test("binds the TensorPrime profile to the SPIFFE deployment configuration", () => {
  const profile = loadTensorPrimeConnectionProfile(profilePath)!;
  assert.doesNotThrow(() =>
    validateTensorPrimeWorkloadBinding(
      profile,
      "tprime.vlans.ca",
      "unix:///run/spiffe/workload/spire-agent.sock",
    ),
  );
  assert.throws(() =>
    validateTensorPrimeWorkloadBinding(
      profile,
      "other.example",
      "unix:///run/spiffe/workload/spire-agent.sock",
    ),
  );
});

test("distinguishes configured, available, rotated, and contradicted SVID readiness", () => {
  const profile = loadTensorPrimeConnectionProfile(profilePath)!;
  const claimed = tensorPrimeSvidReadinessEvidence(profile, "agent-runtime");
  const available = tensorPrimeSvidReadinessEvidence(profile, "agent-runtime", {
    checkedAt: new Date("2026-07-29T12:00:00.000Z"),
    expiresAt: new Date("2026-07-29T12:30:00.000Z"),
    rotationGeneration: 1,
    spiffeId: profile.identities.find(({ component }) => component === "agent-runtime")!.spiffe_id,
  });
  const rotated = tensorPrimeSvidReadinessEvidence(profile, "agent-runtime", {
    checkedAt: new Date("2026-07-29T12:00:00.000Z"),
    expiresAt: new Date("2026-07-29T12:30:00.000Z"),
    rotationGeneration: 2,
    spiffeId: profile.identities.find(({ component }) => component === "agent-runtime")!.spiffe_id,
  });
  const contradicted = tensorPrimeSvidReadinessEvidence(profile, "agent-runtime", {
    checkedAt: new Date("2026-07-29T12:00:00.000Z"),
    expiresAt: new Date("2026-07-29T11:59:59.000Z"),
    rotationGeneration: 0,
    spiffeId: "spiffe://tprime.vlans.ca/ns/other/sa/attacker",
  });

  assert.equal(claimed.state, "claimed");
  assert.equal(available.state, "observed");
  assert.equal(available.svid_available, true);
  assert.equal(available.rotation_observed, false);
  assert.equal(rotated.rotation_observed, true);
  assert.equal(contradicted.state, "contradicted");
  assert.equal(rotated.service_mtls_enforced, false);
  assert.equal(rotated.ray_tls_configured, false);
});

test("rejects profiles that imply TensorPrime mTLS enforcement or contain secrets", () => {
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as TensorPrimeConnectionProfile;
  const unsafe = structuredClone(profile) as unknown as {
    services: Array<{ server_mtls_enforced: boolean }>;
  };
  unsafe.services[0]!.server_mtls_enforced = true;
  const secretBearing = { ...profile, api_key: "must-not-be-accepted" };
  const directory = mkdtempSync(resolve(tmpdir(), "tensorprime-profile-"));
  const unsafePath = resolve(directory, "unsafe.json");
  const secretPath = resolve(directory, "secret.json");
  try {
    writeFileSync(unsafePath, JSON.stringify(unsafe));
    writeFileSync(secretPath, JSON.stringify(secretBearing));
    assert.throws(
      () => loadTensorPrimeConnectionProfile(unsafePath),
      /server_mtls_enforced|Expected false/,
    );
    assert.throws(() => loadTensorPrimeConnectionProfile(secretPath), /api_key|excess/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
