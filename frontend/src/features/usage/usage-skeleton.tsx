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
 * Profile header, headline number, the six-cell grid, tab bar, tab heading,
 * then the Models table with its nine real column labels — every band lands at
 * the height it will occupy once the data arrives, so nothing on the page moves
 * when it does.
 */
export function UsageSkeleton({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <PageContainer width="sm" className="pt-3 sm:pt-4">
      <div className={`flex items-start gap-3 ${embedded ? "justify-end" : "justify-between"}`}>
        {!embedded ? (
          <div className="flex items-center gap-3">
            <div className={`${pulse} h-8 w-8 shrink-0 rounded-full`} />
            <div>
              <div className={`${pulse} h-3.5 w-14`} />
              <div className={`${pulse} mt-1.5 h-5 w-32`} />
            </div>
          </div>
        ) : null}
        <div className={`${pulse} h-7 w-7 rounded-md`} />
      </div>

      <div className="mt-5">
        <div className={`${pulse} h-3.5 w-28`} />
        <div className={`${pulse} mt-2 h-10 w-56`} />
        <div className={`${pulse} mt-2 h-3.5 w-72 max-w-full`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--rad-md)] bg-(--ui-border) sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="bg-(--ui-surface) px-3 py-2 sm:px-3.5">
            <div className={`${pulse} h-5 w-16`} />
            <div className={`${pulse} mt-1.5 h-3.5 w-20`} />
          </div>
        ))}
      </div>

      <div className="mt-5 flex gap-1 border-b border-(--ui-separator)">
        {[64, 68, 84, 60].map((width) => (
          <div key={width} className="px-4 py-2">
            <div className={`${pulse} h-4`} style={{ width }} />
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className={`${pulse} h-6 w-40`} />
        <div className={`${pulse} mt-2 h-3.5 w-[36rem] max-w-full`} />

        <div className="mt-4">
          <TableSkeleton columns={MODEL_COLUMNS} rows={7} minWidthClass="min-w-[64rem]" />
        </div>
      </div>
    </PageContainer>
  );
  return embedded ? content : <AppPage>{content}</AppPage>;
}
