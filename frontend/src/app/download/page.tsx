import type { Metadata } from "next";
import { MarketingLandingPage } from "@/features/marketing/marketing-page";

export const metadata: Metadata = {
  title: "Download vLLM Studio",
  description:
    "Download vLLM Studio and connect local or remote controllers for self-hosted inference.",
};

export default function DownloadPage() {
  return <MarketingLandingPage />;
}
