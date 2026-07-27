import { describe, expect, test } from "bun:test";
import { describeSchedule, normalizeScheduleArg } from "./automations";

describe("normalizeScheduleArg", () => {
  test("accepts an interval schedule and rounds minutes", () => {
    const result = normalizeScheduleArg({ kind: "interval", minutes: 30.4 });
    expect(result).toEqual({ ok: true, schedule: { kind: "interval", minutes: 30 } });
  });

  test("rejects an interval below one minute", () => {
    const result = normalizeScheduleArg({ kind: "interval", minutes: 0 });
    expect(result.ok).toBe(false);
  });

  test("accepts a daily schedule and carries weekdaysOnly only when true", () => {
    expect(normalizeScheduleArg({ kind: "daily", time: "08:30" })).toEqual({
      ok: true,
      schedule: { kind: "daily", time: "08:30" },
    });
    expect(normalizeScheduleArg({ kind: "daily", time: "9:05", weekdaysOnly: true })).toEqual({
      ok: true,
      schedule: { kind: "daily", time: "9:05", weekdaysOnly: true },
    });
  });

  test("rejects a malformed time", () => {
    expect(normalizeScheduleArg({ kind: "daily", time: "25:00" }).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "daily", time: "noon" }).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "daily" }).ok).toBe(false);
  });

  test("accepts a weekly schedule with a valid weekday", () => {
    expect(normalizeScheduleArg({ kind: "weekly", day: 1, time: "07:00" })).toEqual({
      ok: true,
      schedule: { kind: "weekly", day: 1, time: "07:00" },
    });
  });

  test("rejects an out-of-range weekday", () => {
    expect(normalizeScheduleArg({ kind: "weekly", day: 7, time: "07:00" }).ok).toBe(false);
  });

  test("rejects missing or unknown kinds", () => {
    expect(normalizeScheduleArg(undefined).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "hourly" }).ok).toBe(false);
  });
});

describe("describeSchedule", () => {
  test("renders each schedule kind for list output", () => {
    expect(describeSchedule({ kind: "interval", minutes: 15 })).toBe("every 15 min");
    expect(describeSchedule({ kind: "daily", time: "08:00" })).toBe("daily at 08:00");
    expect(describeSchedule({ kind: "daily", time: "08:00", weekdaysOnly: true })).toBe(
      "daily at 08:00 (weekdays)",
    );
    expect(describeSchedule({ kind: "weekly", day: 1, time: "07:00" })).toBe(
      "weekly on Monday at 07:00",
    );
  });
});
