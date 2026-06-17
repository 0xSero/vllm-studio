/**
 * Color utilities for usage charts. Uses the ZCode `--color-usage-chart-*`
 * palette so model colors match the rest of the app and re-theme with it.
 *
 * CSS variable references work in inline styles (where these are consumed);
 * the hex fallbacks cover any canvas/SVG context that cannot resolve vars.
 */

const CHART_VARS = [
  "var(--color-usage-chart-1, #4099ff)", // sky
  "var(--color-usage-chart-2, #46bf72)", // green
  "var(--color-usage-chart-3, #7b5ce5)", // violet
  "var(--color-usage-chart-4, #ff5c5c)", // red
  "var(--color-usage-chart-5, #ff8a30)", // orange
  "var(--color-usage-chart-6, #42c8c8)", // cyan
];

function getModelColor(model: string): string {
  // Use hash of model name for consistent color assignment across renders.
  let hash = 0;
  for (let i = 0; i < model.length; i++) {
    hash = model.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CHART_VARS[Math.abs(hash) % CHART_VARS.length];
}

export { getModelColor };
