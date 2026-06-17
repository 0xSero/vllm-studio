"use client";

import { useSyncExternalStore } from "react";
import {
  getActivitySnapshot,
  heatLevel,
  subscribeActivity,
  type DayBucket,
} from "@/features/dashboard/dashboard-activity-store";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * 14-day GPU utilization heatmap — ZCode usage-page idiom. A grid of sky-ramp
 * cells (5 levels via the `--color-usage-heatmap-*` tokens) laid out in
 * week columns. Presentational only; data comes from the activity store.
 */
export function UtilizationHeatmap() {
  const { days } = useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    getActivitySnapshot,
  );
  const cells = buildCells(days);

  return (
    <div className="rounded-lg border border-(--color-card-border) bg-(--color-card) p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-[length:var(--fs-sm)] font-medium text-(--fg)">Utilization</div>
          <div className="text-[length:var(--fs-xs)] text-(--color-foreground-subtle)">
            Last 14 days · peak GPU %
          </div>
        </div>
        <HeatLegend />
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-around pt-0.5 text-[length:var(--fs-2xs)] text-(--color-foreground-subtlest)">
          {WEEKDAY_LABELS.map((label, i) => (
            <span key={i} className="h-3 leading-3">
              {i % 2 === 1 ? label : ""}
            </span>
          ))}
        </div>
        <div className="flex flex-1 gap-[3px]">
          {cells.weeks.map((week, wi) => (
            <div key={wi} className="flex flex-1 flex-col gap-[3px]">
              {week.days.map((cell, di) => (
                <HeatCell key={di} cell={cell} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-1 pl-5 text-[length:var(--fs-2xs)] text-(--color-foreground-subtlest)">
        {cells.monthMarks.map((mark, i) => (
          <span key={i} className="flex-1">
            {mark}
          </span>
        ))}
      </div>
    </div>
  );
}

type Cell = {
  day: string | null;
  at: number;
  level: 0 | 1 | 2 | 3 | 4;
  value: number;
  samples: number;
};

function buildCells(days: DayBucket[]): { weeks: { days: Cell[] }[]; monthMarks: string[] } {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Start from the Sunday of the week 13 days ago, so we render full weeks.
  const totalDays = 14;
  const end = today.getTime();
  const start = end - (totalDays - 1) * 86_400_000;
  const startSunday = start - new Date(start).getDay() * 86_400_000;

  const allCells: Cell[] = [];
  for (let t = startSunday; t <= end; t += 86_400_000) {
    const ds = new Date(t);
    const key = `${ds.getFullYear()}-${String(ds.getMonth() + 1).padStart(2, "0")}-${String(ds.getDate()).padStart(2, "0")}`;
    const bucket = byDay.get(key);
    if (t < start) {
      allCells.push({ day: null, at: t, level: 0, value: 0, samples: 0 });
    } else {
      allCells.push({
        day: key,
        at: t,
        level: bucket ? heatLevel(bucket.peakUtil) : 0,
        value: bucket?.peakUtil ?? 0,
        samples: bucket?.samples ?? 0,
      });
    }
  }

  // Group into weeks (7-day columns).
  const weeks: { days: Cell[] }[] = [];
  for (let i = 0; i < allCells.length; i += 7) {
    weeks.push({ days: allCells.slice(i, i + 7) });
  }

  // Month labels — one per week boundary.
  const monthMarks: string[] = [];
  let lastMonth = -1;
  for (const week of weeks) {
    const midCell = week.days[Math.floor(week.days.length / 2)];
    if (!midCell) {
      monthMarks.push("");
      continue;
    }
    const m = new Date(midCell.at).getMonth();
    if (m !== lastMonth) {
      monthMarks.push(MONTH_LABELS[m]);
      lastMonth = m;
    } else {
      monthMarks.push("");
    }
  }

  return { weeks, monthMarks };
}

function HeatCell({ cell }: { cell: Cell }) {
  const bgClass = cell.day
    ? [
        "bg-(--color-usage-heatmap-0)",
        "bg-(--color-usage-heatmap-1)",
        "bg-(--color-usage-heatmap-2)",
        "bg-(--color-usage-heatmap-3)",
        "bg-(--color-usage-heatmap-4)",
      ][cell.level]
    : "bg-transparent";
  const dateLabel = cell.day ? `${cell.value.toFixed(0)}% peak · ${cell.samples} samples` : "";
  return (
    <div
      className={`h-3 w-full rounded-[3px] ${bgClass} ${cell.day ? "ring-1 ring-inset ring-(--color-border)" : ""} transition-colors`}
      title={dateLabel}
    />
  );
}

function HeatLegend() {
  return (
    <div className="flex items-center gap-1 text-[length:var(--fs-2xs)] text-(--color-foreground-subtlest)">
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((level) => (
        <span
          key={level}
          className={`h-2.5 w-2.5 rounded-[2px] ${
            [
              "bg-(--color-usage-heatmap-0)",
              "bg-(--color-usage-heatmap-1)",
              "bg-(--color-usage-heatmap-2)",
              "bg-(--color-usage-heatmap-3)",
              "bg-(--color-usage-heatmap-4)",
            ][level]
          }`}
        />
      ))}
      <span>More</span>
    </div>
  );
}
