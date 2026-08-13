import { Suspense } from "react";
import { Spinner } from "@/ui";
import { IntegrationsContent } from "@/features/integrations/integrations-page";

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center" role="status">
          <Spinner size="sm" />
          <span className="sr-only">Loading plugins</span>
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}
