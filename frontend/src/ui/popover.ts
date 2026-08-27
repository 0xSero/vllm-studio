const POPOVER_SHADOW_CLASS =
  "shadow-[0_12px_30px_-16px_rgba(0,0,0,0.72),0_2px_8px_-4px_rgba(0,0,0,0.32)]";

/** Bare surface: 8px radius, single hairline, shared elevation. No padding. */
export const POPOVER_SURFACE_CLASS =
  `rounded-[var(--rad-md)] border border-(--color-popover-border) bg-(--color-popover) ${POPOVER_SHADOW_CLASS}` as const;

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

/**
 * Dialog surface. Sits above a translucent scrim rather than replacing the
 * page, so the app stays visible behind it the way it does in ChatGPT. Larger
 * radius and a deeper shadow than a menu popover — a dialog reads as a sheet
 * lifted off the page, not a dropdown pinned to a trigger.
 */
export const MODAL_SURFACE_CLASS =
  "overflow-hidden rounded-[var(--rad-xl)] border border-(--color-popover-border) bg-(--color-popover) shadow-[0_24px_60px_-20px_rgba(0,0,0,0.68),0_6px_18px_-8px_rgba(0,0,0,0.38)]" as const;

/** Hairline separator between groups inside a popover. */
export const POPOVER_SEPARATOR_CLASS = "my-1 h-px bg-(--border)";
