"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ExperimentTracker } from "@/features/scientist/experiment-tracker";

function ExperimentsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project") ?? "";
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {projectId ? (
        <ExperimentTracker projectId={projectId} />
      ) : (
        <div className="text-center text-muted-foreground">
          No project selected. Open a project first to track experiments.
        </div>
      )}
    </div>
  );
}

export default function ExperimentsPage() {
  return (
    <Suspense>
      <ExperimentsContent />
    </Suspense>
  );
}
