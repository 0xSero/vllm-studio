import type { Metadata } from "next";
import { AgentsPage } from "@/features/marketing/marketing-page";

export const metadata: Metadata = {
  title: "vLLM Studio Agents",
  description:
    "DLTL setup instructions for agents configuring vLLM Studio controllers, providers, runtimes, MCP tools, and Pi sessions.",
};

export default function AgentsRoute() {
  return <AgentsPage />;
}
