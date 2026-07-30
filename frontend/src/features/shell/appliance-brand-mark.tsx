"use client";

import { BRAND_PROFILE } from "@/lib/brand-profile";

export function ApplianceBrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <img
        src={BRAND_PROFILE.iconSvgPath}
        alt=""
        className="h-7 w-7 shrink-0 object-contain"
        aria-hidden="true"
      />
    );
  }

  if (BRAND_PROFILE.applianceId !== "cortaix-factory") {
    return (
      <span className="truncate text-[length:var(--fs-sm)] font-medium text-(--fg)">
        {BRAND_PROFILE.appName}
      </span>
    );
  }

  const logoClass = "h-8 max-w-full object-contain object-left";

  return (
    <span role="img" aria-label={BRAND_PROFILE.appName} className="flex min-w-0 items-center">
      <img
        src={BRAND_PROFILE.logoDarkPath}
        alt=""
        aria-hidden="true"
        className={`appliance-brand-mark__dark ${logoClass}`}
      />
      <img
        src={BRAND_PROFILE.logoLightPath}
        alt=""
        aria-hidden="true"
        className={`appliance-brand-mark__light ${logoClass}`}
      />
      <img
        src={BRAND_PROFILE.logoHighContrastPath}
        alt=""
        aria-hidden="true"
        className={`appliance-brand-mark__high-contrast ${logoClass}`}
      />
      <img
        src={BRAND_PROFILE.logoForcedColorsPath}
        alt=""
        aria-hidden="true"
        className={`appliance-brand-mark__forced-colors ${logoClass}`}
      />
    </span>
  );
}
