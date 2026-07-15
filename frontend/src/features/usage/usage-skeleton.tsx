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
        <div className="flex flex-col items-center pt-20">
          <div className={`${pulse} h-3 w-24`} />
          <div className={`${pulse} mt-4 h-14 w-64`} />
          <div className={`${pulse} mt-4 h-3 w-72`} />
        </div>
        <Card padding="sm" className="mx-auto mt-12 max-w-[55rem]">
          <div className="grid grid-cols-4 gap-8 px-5 py-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex flex-col items-center gap-2">
                <div className={`${pulse} h-5 w-16`} />
                <div className={`${pulse} h-3 w-14`} />
              </div>
            ))}
          </div>
        </Card>
        <div className="mx-auto mt-16 max-w-[55rem]">
          <div className={`${pulse} mb-5 h-4 w-28`} />
          <div className={`${pulse} h-28 w-full opacity-70`} />
        </div>
      </PageContainer>
    </AppPage>
  );
}
