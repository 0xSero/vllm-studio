import { AppPage, PageContainer } from "@/ui";

const pulse = "animate-pulse rounded bg-(--surface-2)";

export function UsageSkeleton() {
  return (
    <AppPage>
      <PageContainer width="md" className="2xl:px-10" aria-busy="true">
        <div className="mb-3 flex items-center gap-2 border-b border-(--border)/35 pb-2">
          <div className={`${pulse} h-3 w-12`} />
          <div className={`${pulse} h-7 w-44 rounded-md`} />
        </div>
        <section className="px-2 pt-2 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className={`${pulse} h-3 w-32`} />
              <div className={`${pulse} h-8 w-56`} />
              <div className={`${pulse} h-3 w-48`} />
            </div>
            <div className={`${pulse} h-8 w-20 rounded-md`} />
          </div>
          <div className="mt-5 grid grid-cols-2 border-b border-(--border)/40 pb-5 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="space-y-2 border-r border-(--border)/40 px-4 first:pl-0 last:border-r-0"
              >
                <div className={`${pulse} h-2.5 w-16`} />
                <div className={`${pulse} h-6 w-24`} />
                <div className={`${pulse} h-2.5 w-20`} />
              </div>
            ))}
          </div>
        </section>
        <div className="mb-3 flex items-center justify-between px-2">
          <div className={`${pulse} h-8 w-56 rounded-md`} />
          <div className={`${pulse} h-7 w-44 rounded-md`} />
        </div>
        <div className="mx-2 h-64 border-y border-(--border)/40 py-5">
          <div className={`${pulse} h-full w-full rounded-md opacity-60`} />
        </div>
        <div className="px-2 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className={`${pulse} h-3 w-32`} />
            <div className={`${pulse} h-3 w-16`} />
          </div>
          <div className="divide-y divide-(--border)/30 border-y border-(--border)/40">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_7rem] gap-5 py-3">
                <div className={`${pulse} h-4 w-2/3`} />
                <div className={`${pulse} h-4 w-full`} />
                <div className={`${pulse} h-4 w-full`} />
              </div>
            ))}
          </div>
        </div>
      </PageContainer>
    </AppPage>
  );
}
