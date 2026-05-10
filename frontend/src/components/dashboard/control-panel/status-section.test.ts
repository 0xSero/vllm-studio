import { describe, expect, it } from "vitest";
import { firstPositive, metricValue, ratioMetric } from "./status-section";

describe("status metric formatting", () => {
  it("returns unavailable-ready nulls instead of fake zeroes for missing runtime metrics", () => {
    expect(firstPositive(undefined, null, 0)).toBeNull();
    expect(metricValue(0, 1)).toBeNull();
    expect(metricValue(null, 1)).toBeNull();
    expect(ratioMetric(0, 100, "W")).toBeNull();
    expect(ratioMetric(12, 0, "W")).toBeNull();
  });

  it("formats positive runtime metrics", () => {
    expect(firstPositive(0, 42, 100)).toBe(42);
    expect(metricValue(42.25, 1)).toBe("42.3");
    expect(ratioMetric(712.4, 1200, "W")).toBe("712/1200W");
    expect(ratioMetric(38.24, 192, "G", 1)).toBe("38.2/192G");
  });
});
