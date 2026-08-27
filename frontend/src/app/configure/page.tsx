import { Suspense } from "react";
import ConfigurePage from "@/features/configure/configure-page";
import { ConfigurePageSkeleton } from "@/features/configure/configure-skeleton";

export default function Page() {
  // The boundary exists for useSearchParams; it renders the same skeleton the
  // route's loading.tsx does, so nothing about the page moves between them.
  return (
    <Suspense fallback={<ConfigurePageSkeleton />}>
      <ConfigurePage />
    </Suspense>
  );
}
