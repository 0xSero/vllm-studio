/**
 * Shared floating-surface classes.
 *
 * One hairline only: the CSS border. `--color-popover-border` resolves to
 * `--color-border` in light and `transparent` in dark (Codex dropdowns float on
 * shadow alone), so the drop shadow must NOT add its own `0 0 0 .5px` ring —
 * that stacked a second hairline on top of the border in light mode.
 *
 * Outer edge -> `--color-popover-border`. Internal dividers -> `--border`.
 */
const POPOVER_SHADOW_CLASS = "shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.3)]";

/** Bare surface: 8px radius, single hairline, shared elevation. No padding. */
export const POPOVER_SURFACE_CLASS =
  `rounded-lg border border-(--color-popover-border) bg-(--color-popover) ${POPOVER_SHADOW_CLASS}` as const;

/**
 * Menu-shaped popover: shared surface plus a tight 4px inset that lets
 * 8px-radius rows nest cleanly inside the 8px corner.
 */
export const POPOVER_MENU_CLASS = `${POPOVER_SURFACE_CLASS} overflow-hidden p-1` as const;

/**
 * Full-bleed popover: rows/dividers run edge to edge, so no inset — but the
 * surface must clip so hover rectangles cannot poke past the rounded corners.
 */
export const POPOVER_PANEL_CLASS = `${POPOVER_SURFACE_CLASS} overflow-hidden` as const;

/** Hairline separator between groups inside a popover. */
export const POPOVER_SEPARATOR_CLASS = "my-1 h-px bg-(--border)";
