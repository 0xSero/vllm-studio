const CHART_VARS = [
  "var(--color-usage-chart-1, #6b8db5)",
  "var(--color-usage-chart-2, #2f8f5f)",
  "var(--color-usage-chart-3, #8672b9)",
  "var(--color-usage-chart-4, #d35656)",
  "var(--color-usage-chart-5, #c8792f)",
  "var(--color-usage-chart-6, #2d8e91)",
  "var(--color-usage-chart-7, #c9a227)",
  "var(--color-usage-chart-8, #d65a93)",
  "var(--color-usage-chart-9, #5a78d6)",
  "var(--color-usage-chart-10, #88b540)",
  "var(--color-usage-chart-11, #b14a7a)",
  "var(--color-usage-chart-12, #3aa7d8)",
];

function getModelColor(index: number): string {
  const size = CHART_VARS.length;
  const normalized = ((index % size) + size) % size;
  return CHART_VARS[normalized];
}

export { getModelColor };
