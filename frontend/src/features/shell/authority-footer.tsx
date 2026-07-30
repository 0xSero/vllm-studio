import { BRAND_PROFILE } from "@/lib/brand-profile";

const LEVEL_RANK = {
  open: 0,
  internal: 1,
  restricted: 2,
  sealed: 3,
  contained: 4,
} as const;

export function AuthorityFooter() {
  if (BRAND_PROFILE.applianceId !== "cortaix-factory") return null;

  const rank = LEVEL_RANK[BRAND_PROFILE.handlingLevel];

  return (
    <footer
      role="contentinfo"
      aria-label={`${BRAND_PROFILE.classificationLabel} classification, derived from appliance profile`}
      data-handling-level={BRAND_PROFILE.handlingLevel}
      data-handling-origin="derived"
      className="authority-footer z-30 grid min-h-[38px] shrink-0 grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-0.5 border-t border-(--border) bg-(--sidebar-bg) px-4 py-1 font-mono text-[11px] text-(--hl2) sm:flex sm:py-0"
    >
      <span className="uppercase tracking-[0.16em]">Classification</span>
      <span className="flex h-[13px] items-end gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((tick) => (
          <span
            key={tick}
            className={`w-[3px] bg-current ${tick <= rank ? "opacity-100" : "opacity-20"}`}
            style={{ height: `${4 + tick * 2}px` }}
          />
        ))}
      </span>
      <strong className="text-[13px] font-medium uppercase tracking-[0.14em] text-(--fg)">
        {BRAND_PROFILE.classificationCode}
      </strong>
      <span className="text-(--hl2)">{BRAND_PROFILE.classificationLabel}</span>
      <span className="hidden min-w-3 flex-1 sm:block" />
      <span className="hidden whitespace-nowrap uppercase tracking-[0.06em] lg:inline">
        Derived · appliance profile
      </span>
      <span className="hidden h-4 w-px bg-(--separator) md:block" aria-hidden="true" />
      <span className="col-span-3 whitespace-nowrap font-sans text-[10px] sm:col-auto sm:text-[11px]">
        mode changes deployment, not governance semantics
      </span>
      <span className="hidden h-4 w-px bg-(--separator) xl:block" aria-hidden="true" />
      <strong className="hidden font-sans text-[12px] tracking-[0.34em] text-(--fg) xl:inline">
        THALES
      </strong>
    </footer>
  );
}
