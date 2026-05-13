import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatDurationOrUnavailable,
  formatNumber,
  toGB,
  toGBFromMB,
} from "./formatters";

describe("formatters", () => {
  it("normalizes memory units into GB", () => {
    expect(toGB(8 * 1024 ** 3)).toBe(8);
    expect(toGB(2048)).toBe(2);
    expect(toGB(1.234)).toBe(1.23);
    expect(toGB(-1)).toBe(0);
    expect(toGBFromMB(1536)).toBe(1.5);
  });

  it("formats counts, durations, dates, and bytes for display", () => {
    expect(formatNumber(1_500)).toBe("1.5K");
    expect(formatNumber(2_000_000)).toBe("2.00M");
    expect(formatNumber(3_000_000_000)).toBe("3.00B");
    expect(formatDuration(1250)).toBe("1.3s");
    expect(formatDuration(42.4)).toBe("42ms");
    expect(formatDurationOrUnavailable(null)).toBe("unavailable");
    expect(formatDurationOrUnavailable(10)).toBe("10ms");
    expect(formatDate("2026-05-12T12:00:00.000Z")).toMatch(/May 1?2/);
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});
