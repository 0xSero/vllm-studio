import type { Metadata } from "next";
import { DocsPage } from "@/features/landing-page/landing-page";

export const metadata: Metadata = {
  title: "Docs — Local Studio",
  description:
    "Setup guide for Local Studio: prerequisites, quick start, runtime backends, agent runtime, remote/LAN deployment, and validation.",
};

export default function DocsRoute() {
  return <DocsPage />;
}
