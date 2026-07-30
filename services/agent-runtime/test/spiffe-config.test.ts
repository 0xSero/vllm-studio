import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import type { WorkloadIdentityConfig } from "@local-studio/contracts/workload-identity";
import {
  loadWorkloadIdentityConfig,
  resetWorkloadIdentityConfigForTest,
  resolveAgentRuntimeBindHostname,
} from "../src/spiffe-config";
import { resetTensorPrimeConnectionProfileForTest } from "../src/tensorprime-profile";

const directory = mkdtempSync(join(tmpdir(), "spiffe-config-"));
const path = join(directory, "workload-identity.json");
const config: WorkloadIdentityConfig = {
  mode: "required",
  endpoint: "unix:///run/spire/sockets/spire-agent.sock",
  trust_domain: "example.org",
  frontend_id: "spiffe://example.org/ns/studio/sa/frontend",
  controller_id: "spiffe://example.org/ns/studio/sa/controller",
  agent_runtime_id: "spiffe://example.org/ns/studio/sa/agent-runtime",
  agent_runtime_audience: "local-studio-agent-runtime",
  controller_audience: "local-studio-controller",
};

const rejectsConfig = (value: WorkloadIdentityConfig): void => {
  writeFileSync(path, JSON.stringify(value));
  process.env.LOCAL_STUDIO_SPIFFE_CONFIG = path;
  resetWorkloadIdentityConfigForTest();
  assert.throws(() => loadWorkloadIdentityConfig());
};

after(() => {
  delete process.env.LOCAL_STUDIO_SPIFFE_CONFIG;
  delete process.env.LOCAL_STUDIO_TENSORPRIME_PROFILE;
  resetWorkloadIdentityConfigForTest();
  resetTensorPrimeConnectionProfileForTest();
  rmSync(directory, { recursive: true, force: true });
});

test("rejects noncanonical sockets and SPIFFE IDs", () => {
  rejectsConfig({
    ...config,
    endpoint: "unix:///run/spire/../attacker.sock",
    frontend_id: "spiffe://example.org/ns/studio/../attacker",
  });
});

test("rejects collapsed identities, audiences, and malformed trust domains", () => {
  rejectsConfig({ ...config, controller_id: config.frontend_id });
  rejectsConfig({ ...config, controller_audience: config.agent_runtime_audience });
  rejectsConfig({
    ...config,
    trust_domain: "example..org",
    frontend_id: "spiffe://example..org/ns/studio/sa/frontend",
    controller_id: "spiffe://example..org/ns/studio/sa/controller",
    agent_runtime_id: "spiffe://example..org/ns/studio/sa/agent-runtime",
  });
});

test("permits non-loopback runtime binding only with required workload identity", () => {
  assert.equal(resolveAgentRuntimeBindHostname(config, "0.0.0.0"), "0.0.0.0");
  assert.equal(resolveAgentRuntimeBindHostname(null), "127.0.0.1");
  assert.throws(
    () => resolveAgentRuntimeBindHostname({ ...config, mode: "optional" }, "0.0.0.0"),
    /requires SPIFFE workload identity/,
  );
  assert.throws(() => resolveAgentRuntimeBindHostname(config, "invalid host"));
});

test("binds the TensorPrime profile to the configured workload endpoint and trust domain", () => {
  process.env.LOCAL_STUDIO_TENSORPRIME_PROFILE = resolve(
    import.meta.dirname,
    "../../../deploy/spire/tensorprime-connection-profile.json",
  );
  writeFileSync(
    path,
    JSON.stringify({
      ...config,
      endpoint: "unix:///run/spiffe/workload/spire-agent.sock",
      trust_domain: "tprime.vlans.ca",
      frontend_id: "spiffe://tprime.vlans.ca/ns/local-studio/sa/local-studio-frontend",
      controller_id: "spiffe://tprime.vlans.ca/ns/local-studio/sa/local-studio-controller",
      agent_runtime_id: "spiffe://tprime.vlans.ca/ns/local-studio/sa/local-studio-agent-runtime",
    }),
  );
  resetWorkloadIdentityConfigForTest();
  resetTensorPrimeConnectionProfileForTest();
  assert.equal(loadWorkloadIdentityConfig()?.trust_domain, "tprime.vlans.ca");

  writeFileSync(path, JSON.stringify(config));
  resetWorkloadIdentityConfigForTest();
  assert.throws(() => loadWorkloadIdentityConfig(), /differs from the SPIFFE workload/);
});
