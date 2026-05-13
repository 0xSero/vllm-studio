import { describe, expect, it } from "vitest";
import { safeJsonStringify } from "./safe-json";

describe("safeJsonStringify", () => {
  it("serializes values that JSON.stringify normally rejects", () => {
    const value = {
      count: BigInt(12),
      callback: function namedCallback() {
        return null;
      },
      ids: new Set(["a", "b"]),
      lookup: new Map([["key", "value"]]),
    };

    expect(JSON.parse(safeJsonStringify(value))).toEqual({
      count: "12",
      callback: "[Function namedCallback]",
      ids: ["a", "b"],
      lookup: { key: "value" },
    });
  });

  it("marks circular references instead of throwing", () => {
    const value: { child?: unknown } = {};
    value.child = value;

    expect(JSON.parse(safeJsonStringify(value))).toEqual({ child: "[Circular]" });
  });

  it("falls back when custom serialization throws", () => {
    const value = {
      toJSON() {
        throw new Error("boom");
      },
    };

    expect(safeJsonStringify(value, "fallback")).toBe("fallback");
  });
});
