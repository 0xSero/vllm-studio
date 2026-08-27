import { Suspense } from "react";
import { Workbench } from "@/features/studio";
export default function Page() {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Quick panel</h1>
          <p>Loading local workspace…</p>
        </main>
      }
    >
      <Workbench quick />
    </Suspense>
  );
}
