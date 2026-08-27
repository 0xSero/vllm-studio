import { Suspense } from "react";
import { Workbench } from "@/features/studio";
export default function Page() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Agent</h1>
          <p>Loading local workspace…</p>
        </main>
      }
    >
      <Workbench />
    </Suspense>
  );
}
