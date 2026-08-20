/**
 * The waiting state, shaped like the page it stands in for.
 *
 * The blocks land where the title, the description, the five tabs and the
 * first table's header row land, so nothing moves when the real page arrives.
 * A centred "Loading…" would put a layout on screen that appears nowhere else
 * and then throw the whole frame away.
 */
export function IntegrationsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[86rem] px-4 pt-6 pb-8 sm:px-6 sm:pt-8">
      <div className="mb-4 min-h-8">
        <div className="h-7 w-40 animate-pulse rounded bg-(--ui-hover)" />
        <div className="mt-2 h-3.5 w-80 max-w-full animate-pulse rounded bg-(--ui-hover)/60" />
      </div>
      <div className="mt-7 flex gap-1 border-b border-(--ui-separator) pb-2">
        {[0, 1, 2, 3, 4].map((tab) => (
          <div key={tab} className="h-5 w-24 shrink-0 animate-pulse rounded bg-(--ui-hover)/60" />
        ))}
      </div>
      <div className="mt-8 space-y-2">
        <div className="h-4 w-28 animate-pulse rounded bg-(--ui-hover)" />
        <div className="h-3 w-96 max-w-full animate-pulse rounded bg-(--ui-hover)/60" />
        <div className="space-y-px pt-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-2.5 px-3 py-2">
              <div className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-(--ui-hover)" />
              <div className="h-3.5 w-48 animate-pulse rounded bg-(--ui-hover)" />
              <div className="ml-auto h-3 w-20 animate-pulse rounded bg-(--ui-hover)/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
