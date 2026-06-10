"use client";

import { SetupView } from "@/features/setup/setup-view/setup-view";
import { useSetup } from "@/features/setup/use-setup";

export default function SetupPage() {
  const setup = useSetup();
  return <SetupView {...setup} />;
}
