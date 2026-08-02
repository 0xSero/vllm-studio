import HarnessPage from "@/features/harness/harness-page";
import { initialHarnessObjective } from "@/features/harness/harness-page-model";

type PageProps = {
  searchParams: Promise<{ objective?: string | string[] }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { objective } = await searchParams;
  return <HarnessPage initialGoal={initialHarnessObjective(objective)} />;
}
