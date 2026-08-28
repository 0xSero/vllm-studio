import { describe, expect, test } from "bun:test";
import {
  collectRedactionSecrets,
  redactRecord,
} from "../src/modules/registry/redact";

const SECRETS = {
  hostnames: ["hephaistos.local"],
  homePaths: ["/Users/gil", "/home/gil"],
  uuids: ["GPU-c6ac75f2-cadf-6ff3-4cab-76c6033c1006"],
  envValues: ["hf_token_abcdefghijklmnop123"],
};

describe("redaction", () => {
  test("drops credential-bearing environment fields entirely", () => {
    const { record, redactions } = redactRecord(
      { launch: { environment: { HF_TOKEN: "hf_x", NCCL_P2P_DISABLE: "1", API_KEY: "k" } } },
      SECRETS,
    );
    const environment = (record as any)["launch"]["environment"];
    expect(environment).toEqual({ NCCL_P2P_DISABLE: "1" });
    expect(redactions.join(" ")).toContain('credential-bearing field "HF_TOKEN"');
  });

  test("scrubs home paths, hostnames, device ids, and secret values", () => {
    const { record, redactions } = redactRecord(
      {
        mount: "/Users/gil/models/org/repo",
        node: "hephaistos.local:8080",
        devices: "GPU-c6ac75f2-cadf-6ff3-4cab-76c6033c1006,0",
        leaked: "Bearer hf_token_abcdefghijklmnop123",
      },
      SECRETS,
    );
    expect((record as any)["mount"]).toBe("~/models/org/repo");
    expect((record as any)["node"]).toBe("[redacted-host]:8080");
    expect((record as any)["devices"]).toBe("[redacted-device-id],0");
    expect((record as any)["leaked"]).toBe("Bearer [redacted]");
    expect(redactions.length).toBeGreaterThanOrEqual(3);
  });

  test("collectRedactionSecrets gathers machine identity and credential values", () => {
    const secrets = collectRedactionSecrets(
      [{ uuid: "GPU-abc", pci_bus_id: "0000:03:00.0" } as never],
      { HF_TOKEN: "secret-token-value123", PATH: "/usr/bin", SAFE_VAR: "1" },
    );
    expect(secrets.uuids).toContain("GPU-abc");
    expect(secrets.envValues).toContain("secret-token-value123");
    expect(secrets.envValues).not.toContain("/usr/bin");
    expect(secrets.homePaths.length).toBeGreaterThan(0);
    expect(secrets.hostnames.length).toBeGreaterThan(0);
  });

  test("nested structures survive scrubbing", () => {
    const { record } = redactRecord(
      { a: { b: { c: ["/Users/gil/x", 42, null, true] } } },
      SECRETS,
    );
    expect(record).toEqual({ a: { b: { c: ["~/x", 42, null, true] } } });
  });
});
