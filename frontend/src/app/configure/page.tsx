"use client";

import { useRouter } from "next/navigation";
import { integrationSettingsHref } from "@/features/integrations/integration-navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const CONFIGURE_SECTIONS = ["overview", "rig", "models", "integrations", "server"] as const;
const CONFIGURE_HASH_SECTIONS = ["rig", "models", "integrations", "server"] as const;
const MODEL_TABS = ["picks", "get", "serves", "downloads"] as const;

type ConfigureSection = (typeof CONFIGURE_SECTIONS)[number];

function includesValue<const Values extends readonly string[]>(
  values: Values,
  value: string | null,
): value is Values[number] {
  return value !== null && values.some((candidate) => candidate === value);
}

function legacyConfigureHref(search: string, hash: string): string {
  const searchParams = new URLSearchParams(search);
  const hashSection = hash.replace(/^#/, "");
  const querySection = searchParams.get("section");
  const section: ConfigureSection = includesValue(CONFIGURE_HASH_SECTIONS, hashSection)
    ? hashSection
    : includesValue(CONFIGURE_SECTIONS, querySection)
      ? querySection
      : "overview";

  if (section === "integrations") {
    return integrationSettingsHref(searchParams.get("integration"));
  }
  if (section === "rig" || section === "server") {
    return "/settings#system";
  }
  if (section !== "models") {
    return "/models";
  }

  const modelParams = new URLSearchParams();
  if (searchParams.get("new") === "1") modelParams.set("new", "1");
  const tab = searchParams.get("tab");
  if (includesValue(MODEL_TABS, tab)) modelParams.set("tab", tab);
  const query = modelParams.toString();
  return query ? `/models?${query}` : "/models";
}

export default function ConfigureRedirect() {
  const router = useRouter();
  useMountSubscription(() => {
    router.replace(legacyConfigureHref(window.location.search, window.location.hash));
  }, [router]);
  return null;
}
