import { AppPage, Card, PageContainer } from "@/ui";

const pulse = "animate-pulse rounded bg-(--ui-surface-2)";

export function UsageSkeleton() {
  return (
    <AppPage>
      <PageContainer width="sm" className="pt-5 sm:pt-7">
        <div className="flex items-center justify-between">
          <div className={`${pulse} h-5 w-14`} />
          <div className={`${pulse} h-7 w-44 rounded-full`} />
        </div>
        {/* Mirrors the loaded page: left-aligned hero, left-aligned stats. A
            centred skeleton that resolves into a left-aligned page reads as a
            layout jump. */}
        <div className="mx-auto mt-8 max-w-[55rem]">
          <div className={`${pulse} h-3 w-24`} />
          <div className={`${pulse} mt-2 h-9 w-52`} />
          <div className={`${pulse} mt-3 h-3 w-72`} />
        </div>
        <Card padding="sm" className="mx-auto mt-6 max-w-[55rem]">
          <div className="grid grid-cols-4 gap-8 px-5 py-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className={`${pulse} h-5 w-16`} />
                <div className={`${pulse} h-3 w-14`} />
              </div>
            ))}
          </div>
        </Card>
        <div className="mx-auto mt-6 max-w-[55rem]">
          <div className={`${pulse} mb-5 h-4 w-28`} />
          <div className={`${pulse} h-28 w-full opacity-70`} />
        </div>
      </PageContainer>
    </AppPage>
  );
}
