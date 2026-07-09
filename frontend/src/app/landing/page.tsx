import type { Metadata } from "next";
import { LandingPage } from "@/features/landing-page/landing-page";

export const metadata: Metadata = {
  title: "Local Studio",
  description:
    "A local-first workstation for running, managing, and using self-hosted LLM backends — controllers, GPUs, models, providers, and agents in one operating surface.",
};

export default function LandingRoute() {
  return <LandingPage />;
}
