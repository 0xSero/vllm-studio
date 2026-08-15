"use client";

import { useRouter } from "next/navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  integrationSectionFromLocation,
  integrationSettingsHref,
} from "@/features/integrations/integration-navigation";

export default function IntegrationsRedirect() {
  const router = useRouter();
  useMountSubscription(() => {
    const section = integrationSectionFromLocation(window.location.search, window.location.hash);
    router.replace(integrationSettingsHref(section));
  }, [router]);
  return null;
}
