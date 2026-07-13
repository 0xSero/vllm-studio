import type { Metadata } from "next";
import { AgentsPage } from "@/features/landing-page/agents-page";

export const metadata: Metadata = {
  title: "Local Studio Agents",
  description:
    "DLTL setup instructions for agents configuring Local Studio controllers, providers, runtimes, and Pi sessions.",
};

export default function AgentsRoute() {
  return <AgentsPage />;
}
