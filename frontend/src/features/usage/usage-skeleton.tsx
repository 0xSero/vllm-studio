import { AppPage, PageContainer } from "@/ui";
import { TableSkeleton } from "@/features/recipes/recipes-content/catalog-table-shell";

const pulse = "animate-pulse rounded bg-(--ui-surface-2)";

const MODEL_COLUMNS = [
  "Model",
  "Requests",
  "Tokens",
  "Avg/req",
  "Prefill",
  "Decode",
  "TTFT",
  "Latency",
  "Success",
] as const;

/**
 * The loading state is the loaded page with the ink removed.
 *
 * Header, tab bar, tab heading, context strip, six-up stat strip, then the
 * Models table with its nine real column labels — every band lands at the
 * height it will occupy once the data arrives, so nothing on the page moves
 * when it does.
 */
export function UsageSkeleton() {
  return (
    <AppPage>
      <PageContainer width="sm" className="pt-6 sm:pt-8">
        <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
          <div>
            <div className={`${pulse} h-7 w-28`} />
            <div className={`${pulse} mt-2 h-3.5 w-96 max-w-full`} />
          </div>
          <div className={`${pulse} h-8 w-8 rounded-md`} />
        </div>

        <div className="mt-7 flex gap-1 border-b border-(--ui-separator)">
          {[64, 68, 84, 60].map((width) => (
            <div key={width} className="px-4 py-2">
              <div className={`${pulse} h-4`} style={{ width }} />
            </div>
          ))}
        </div>

        <div className="mt-8">
          <div className={`${pulse} h-6 w-40`} />
          <div className={`${pulse} mt-2 h-3.5 w-[36rem] max-w-full`} />

          <div className="mt-6 flex items-baseline gap-2 border-b border-(--ui-separator) pb-3">
            <div className={`${pulse} h-4 w-24`} />
            <div className={`${pulse} h-3.5 w-64 max-w-full`} />
          </div>

          <div className="mt-6 grid grid-cols-2 divide-x divide-(--ui-separator) border-b border-(--ui-separator) pb-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="px-3 py-2 first:pl-0">
                <div className={`${pulse} h-3 w-16`} />
                <div className={`${pulse} mt-1.5 h-4 w-20`} />
                <div className={`${pulse} mt-1.5 h-3 w-14`} />
              </div>
            ))}
          </div>

          <div className="mt-6">
            <TableSkeleton columns={MODEL_COLUMNS} rows={7} minWidthClass="min-w-[64rem]" />
          </div>
        </div>
      </PageContainer>
    </AppPage>
  );
}
