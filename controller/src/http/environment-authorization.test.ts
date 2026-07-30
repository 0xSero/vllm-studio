import { describe, expect, test } from "bun:test";
import { requiredEntitlement } from "./security-middleware";

describe("environment authorization policy", () => {
  test("requires configuration authority for environment reads, probes, and mutations", () => {
    expect(requiredEntitlement("GET", "/environment/kubernetes")).toBe("configuration:write");
    expect(requiredEntitlement("POST", "/environment/kubernetes/probe")).toBe(
      "configuration:write",
    );
    expect(requiredEntitlement("PUT", "/environment/kubernetes")).toBe("configuration:write");
  });

  test("requires configuration authority for provider reads, probes, and mutations", () => {
    expect(requiredEntitlement("GET", "/studio/providers")).toBe("configuration:write");
    expect(requiredEntitlement("POST", "/studio/providers/probe")).toBe("configuration:write");
    expect(requiredEntitlement("PUT", "/studio/providers/tensorprime")).toBe("configuration:write");
  });
});
